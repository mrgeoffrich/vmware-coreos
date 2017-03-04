import * as vsphere from '../vmware/vsphere';
import * as vspherecis from './definitions/vspherecis';
import * as vspherests from './definitions/vspherests';
import * as vspherevim from './definitions/vspherevim';
import * as xmldom from 'xmldom';
import * as path from 'path';
import * as ip from 'ip';
import { checkDatastoreFileExists } from './getFolderContents';
import { uploadHttpsFileProgress } from './fileUploadProgress';
import { uploadFile } from './simpleUploadFile';
import { ITaskManager } from './taskManager';

export interface GuestinfoConfigSetting {
    key: string;
    value: string;
}

export class VMWare {
    SessionManager: vspherevim.vimService.vim.ManagedObjectReference;
    UserSession: vspherevim.vimService.vim.UserSession;
    TaskManager: ITaskManager;

    Host: string;
    cisService: vspherecis.cisService;
    vimService: vspherevim.vimService;
    stsService: vspherests.stsService;
    samlToken: any;

    constructor(taskManager: ITaskManager) {
        this.TaskManager = taskManager;
    }

    private appendToken(stsService: vspherests.stsService, samlToken: Node, { body, outgoing }) {
        if (outgoing) {
            let header = body.createElementNS(
                'http://schemas.xmlsoap.org/soap/envelope/', 'Header');
            let securityElement = stsService.serializeObject(
                stsService.wsse.SecurityHeaderType({
                    Timestamp: stsService.wsu.TimestampType({
                        Created: stsService.wsu.AttributedDateTime({
                            value: new Date().toISOString()
                        }),
                        Expires: stsService.wsu.AttributedDateTime({
                            value: new Date(Date.now() + 9000 * 60 * 10).toISOString()
                        })
                    })
                }), 'Security');
            securityElement.appendChild(samlToken);
            header.appendChild(securityElement);
            body.firstChild.insertBefore(header, body.firstChild.firstChild);
        }
    }

    private async issueToken(stsService: vspherests.stsService, username: string, password: string) {
        let samlToken;
        let { addHandler, serializeObject, stsPort, wst13, wsse, wsu } = stsService;
        let requestSecurityToken = wst13.RequestSecurityTokenType({
            Delegatable: true,
            KeyType: wst13.KeyTypeEnum
            ['http://docs.oasis-open.org/ws-sx/ws-trust/200512/Bearer'],
            Lifetime: wst13.LifetimeType({
                Created: wsu.AttributedDateTime({
                    value: new Date().toISOString()
                }),
                Expires: wsu.AttributedDateTime({
                    value: new Date(Date.now() + 9000 * 60 * 10).toISOString()
                })
            }),
            Renewing: wst13.RenewingType({
                Allow: false,
                OK: false
            }),
            RequestType: wst13.RequestTypeOpenEnum
            ['http://docs.oasis-open.org/ws-sx/ws-trust/200512/Issue'],
            SignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
            TokenType: 'urn:oasis:names:tc:SAML:2.0:assertion'
        });
        addHandler(({ body, outgoing }) => {
            if (outgoing) {
                let securityHeader = wsse.SecurityHeaderType({
                    Timestamp: wsu.TimestampType({
                        Created: wsu.AttributedDateTime({
                            value: new Date().toISOString()
                        }),
                        Expires: wsu.AttributedDateTime({
                            value: new Date(Date.now() + 9000 * 60 * 10).toISOString()
                        })
                    }),
                    UsernameToken: wsse.UsernameTokenType({
                        Username: wsse.AttributedString({
                            value: username
                        }),
                        Password: wsse.PasswordString({
                            value: password
                        })
                    })
                });
                let header = body.createElementNS(
                    'http://schemas.xmlsoap.org/soap/envelope/', 'Header');
                header.appendChild(serializeObject(securityHeader, 'Security'));
                body.firstChild.insertBefore(header, body.firstChild.firstChild);
            }
        });
        addHandler(({ body, outgoing }) => {
            if (!outgoing) {
                samlToken = body.getElementsByTagNameNS(
                    'urn:oasis:names:tc:SAML:2.0:assertion', 'Assertion')[0];
            }
        });
        await stsPort.issue(requestSecurityToken);
        return samlToken;
    }

    /** Connect to a vcenter server. */
    public async Connect(hostname: string, username: string, password: string) {
        this.TaskManager.StartStep(false, 'Connect to VCenter', 'desktop_computer');
        this.Host = hostname;
        this.cisService = await vsphere.cisService(hostname);
        this.stsService = await vsphere.stsService(hostname);
        this.vimService = await vsphere.vimService(hostname);
        this.samlToken = await this.issueToken(this.stsService, username, password);
        let handler = this.appendToken.bind(null, this.stsService, this.samlToken);
        this.vimService.addHandler(handler);
        this.UserSession = await this.vimService.vimPort.loginByToken(
            this.vimService.serviceContent.sessionManager, null);
        this.vimService.removeHandler(handler);
        this.cisService.setSecurityContext({
            samlToken: new xmldom.XMLSerializer().serializeToString(this.samlToken),
            schemeId: this.cisService.vapi.std.AuthenticationScheme.SAML_BEARER_TOKEN
        });
        let sessionId = await this.cisService.cis.session.create();
        this.cisService.setSecurityContext({
            schemeId: this.cisService.vapi.std.AuthenticationScheme.SESSION_ID,
            sessionId
        });
        this.SessionManager = this.vimService.serviceContent.sessionManager;
        this.TaskManager.FinishStep();
    }

    /** Disconnect. */
    public async Disconnect() {
        this.TaskManager.StartStep(false, 'Logout from VCenter', 'desktop_computer');
        await this.vimService.vimPort.logout(this.vimService.serviceContent.sessionManager);
        await this.cisService.cis.session.delete();
        this.TaskManager.FinishStep();
    }

    public async ContentLibraryExists(libraryName: string): Promise<string> {
        let { content } = this.cisService;
        let { library } = content;
        this.TaskManager.StartStep(false, `Check library '${libraryName}' exists`, 'mag_right');
        let findSpec = this.cisService.content.library.FindSpec({ name: libraryName });
        var allLibraries = await library.find(findSpec);
        if (allLibraries.length > 0) {
            this.TaskManager.FinishStep('Library found.');
            return allLibraries[0];
        } else {
            throw Error('Unable to find content library');
        }
    }
    /** Check to see if a content library exists and if it doesn't, create it. */
    public async ContentLibraryExistsAndCreate(libraryName: string, datastore: vspherevim.vimService.vim.ManagedObjectReference): Promise<string> {
        let { content, uuid } = this.cisService;
        let { library, localLibrary } = content;
        this.TaskManager.StartStep(false, `Check library '${libraryName}' exists`, 'mag_right');
        let findSpec = this.cisService.content.library.FindSpec({ name: libraryName });
        var allLibraries = await library.find(findSpec);
        if (allLibraries.length > 0) {
            this.TaskManager.FinishStep('Library found.');
            return allLibraries[0];
        } else {
            this.TaskManager.FinishStep('Library not found.');
            this.TaskManager.StartStep(false, `Create new content library ${libraryName}`, 'heavy_plus_sign');
            // Now create the library since it doesn't exist
            let libraryModel = content.LibraryModel({
                description: 'Core OS Library',
                id: uuid(),
                name: libraryName,
                publish_info: library.PublishInfo({
                    authentication_method: 'NONE',
                    published: true
                }),
                storageBackings: [
                    library.StorageBacking({
                        type: 'DATASTORE',
                        datastoreId: datastore.value,
                    })
                ],
                type: 'LOCAL'
            });
            let returnValue = await localLibrary.create(uuid(), libraryModel);
            this.TaskManager.FinishStep();
            return returnValue;
        }
    }

    /** See if an item already exists by name in a library. */
    public async LibraryItemExists(libraryId: string, itemName: string): Promise<boolean> {
        let content = this.cisService.content;
        let library = content.library;
        let findSpec = this.cisService.content.library.item.FindSpec({ name: itemName });
        let libraryItems = await library.item.find(findSpec);
        return libraryItems.length > 0;
    }

    /** Get the ID of a library item by name. */
    public async GetLibraryItemId(libraryId: string, itemName: string): Promise<string> {
        let content = this.cisService.content;
        let library = content.library;
        let findSpec = this.cisService.content.library.item.FindSpec({ name: itemName });
        let libraryItems = await library.item.find(findSpec);
        if (libraryItems.length > 0) {
            return libraryItems[0];
        }
    }

    /** Upload the contents of an OVA file to a content library.
     * @param {string} libraryId - The unique ID of the library.
     * @param {string} ovfFilename - The name of the OVF file excluding the path.
     * @param {string} vmdkFilename - The name of the VMDK file excluding the path.
     * @param {string} filepath - The folder/directory of the OVF and VMDK files.
     * @param {string} libraryItemName - The name of the item in the library to call this OVA template.
     * @param {string} itemDescription - A text description of the template item in the library. 
     */
    public async UploadOVAContentsToLibrary(libraryId: string, ovfFilename: string,
        vmdkFilename: string,
        filepath: string,
        libraryItemName: string,
        itemDescription: string) {
        let { content, uuid } = this.cisService;
        let { library } = content;
        let itemModel = library.ItemModel({
            description: itemDescription,
            id: uuid(),
            libraryId: libraryId,
            name: libraryItemName,
            type: 'ovf'
        });
        this.TaskManager.StartStep(false, 'Create library item for OVA upload', 'heavy_plus_sign');
        let libraryItemId = await library.item.create(uuid(), itemModel);
        let libraryItem = await library.item.get(libraryItemId);
        let updateModelSpec = library.item.UpdateSessionModel({
            libraryItemId: libraryItemId,
            libraryItemContentVersion: libraryItem.contentVersion
        });
        let sessionId = await library.item.updateSession.create(uuid(),
            updateModelSpec);
        this.TaskManager.FinishStep();
        let fileNames = [ovfFilename, vmdkFilename];
        for (let name of fileNames) {
            this.TaskManager.StartStep(false, `Upload ${name}`, 'arrow_double_up');
            let addSpec = library.item.updatesession.file.AddSpec({
                name,
                sourceType: 'PUSH'
            });
            let info = await library.item.updatesession.file.add(sessionId, addSpec);
            let filePath = path.join(filepath, name);
            await uploadFile(filePath, info.uploadEndpoint.uri);
            this.TaskManager.FinishStep();
        }
        let validationResult =
            await library.item.updatesession.file.validate(sessionId);

        if (validationResult.invalidFiles.length === 0 && validationResult.missingFiles.length === 0) {
            await library.item.updateSession.complete(sessionId);
            await library.item.updateSession.delete(sessionId);
        } else if (validationResult.invalidFiles.length !== 0) {
            await library.item.updateSession.fail(sessionId,
                validationResult.invalidFiles[0].errorMessage.defaultMessage);
            await library.item.updateSession.delete(sessionId);
            throw Error('Invalid Files: ' + validationResult.invalidFiles);
        } else if (validationResult.missingFiles.length !== 0) {
            await library.item.updateSession.cancel(sessionId);
            throw Error('Missing Files: ' + validationResult.missingFiles);
        }
    }

    /** Set the extra config settings of a virtual machine. Useful for setting guestinfo variables.
     * 
     */
    public async ReconfigureVM(vmName: string, configSettings: Array<GuestinfoConfigSetting>) {
        this.TaskManager.StartStep(false, `Reconfigure VM ${vmName}`, 'gear');
        let virtualMachine = await this.GetManagedObject(vmName, 'VirtualMachine', true);
        if (virtualMachine === null) {
            throw Error('VM not found.');
        }
        let extraConfig: Array<vspherevim.vimService.vim.OptionValue> = Array<vspherevim.vimService.vim.OptionValue>();
        for (let configSetting of configSettings) {
            extraConfig.push(this.vimService.vim.OptionValue({ key: configSetting.key, value: this.vimService.xs.String({ value: configSetting.value }) }));
        }
        let spec = this.vimService.vim.VirtualMachineConfigSpec({
            extraConfig: extraConfig
        });
        await this.completeTask(this.vimService,
            await this.vimService.vimPort.reconfigVMTask(virtualMachine, spec));
        this.TaskManager.FinishStep();
    }

    /** Deploy an OVA from a content library to a particular resourcepool, host and datastore.
     * @param {string} templateName - The name of the template to deploy.
     * @param {string} vmName - The name of the new virtual machine.
     * @param {vspherevim.vimService.vim.ManagedObjectReference} resourcePool - The resource pool to deploy this VM into.
     * @param {vspherevim.vimService.vim.ManagedObjectReference} datastore - The datastore to store the new VM on. Optional.
     * @param {vspherevim.vimService.vim.ManagedObjectReference} host - The host server to deploy the OVA to. Optional.
     */
    public async DeployOva(libraryId: string,
        templateName: string,
        vmName: string,
        resourcePool: vspherevim.vimService.vim.ManagedObjectReference,
        datastore?: vspherevim.vimService.vim.ManagedObjectReference,
        host?: vspherevim.vimService.vim.ManagedObjectReference): Promise<vspherevim.vimService.vim.ManagedObjectReference> {
        this.TaskManager.StartStep(false, `Deploy OVA ${templateName} to VM ${vmName}`, 'unicorn_face');
        let { ovf, uuid } = this.cisService;
        let deploymentTarget = ovf.libraryItem.DeploymentTarget({
            resourcePoolId: resourcePool.value,
            hostId: host.value
        });
        let libraryItemId = await this.GetLibraryItemId(libraryId, templateName);
        let ovfSummary = await ovf.libraryItem.filter(libraryItemId,
            deploymentTarget);
        let deploymentSpec = ovf.libraryItem.ResourcePoolDeploymentSpec({
            acceptAllEULA: true,
            annotation: ovfSummary.annotation,
            name: vmName,
            storageProvisioning: 'thin',
            defaultDatastoreId: datastore.value
        });
        let deploymentResult = await ovf.libraryItem.deploy(uuid(), libraryItemId,
            deploymentTarget, deploymentSpec);
        if (deploymentResult.succeeded) {
            this.TaskManager.FinishStep(`VM id: ${deploymentResult.resourceId.id}`);
            let vmRef = this.vimService.vim.ManagedObjectReference({
                type: 'VirtualMachine',
                value: deploymentResult.resourceId.id
            });
            return vmRef;
        } else {
            throw Error('Error deploying template to VM: ' + deploymentResult.error.errors[0].message);
        }
    }

    /** Each host may have a child default resource pool. This is not visible in the vcenter UI. This will return that resource pool.
     * Note: BROKEN - need to manage hosts that dont have resource pools when they are in a cluster
     */
    public async GetDefaultResourcePoolForHost(host: vspherevim.vimService.vim.ManagedObjectReference): Promise<vspherevim.vimService.vim.ManagedObjectReference> {
        let { serviceContent: {
            propertyCollector,
            viewManager
        }, vim, vimPort } = this.vimService;
        let containerView = await this.vimService.vimPort.createContainerView(viewManager, host, ['ManagedEntity'], true);
        let targetObjects = await vimPort.retrievePropertiesEx(propertyCollector, [
            vim.PropertyFilterSpec({
                objectSet: [vim.ObjectSpec({
                    obj: containerView,
                    skip: false,
                    selectSet: [vim.TraversalSpec({
                        path: 'view',
                        type: 'ContainerView'
                    })]
                })],
                propSet: [vim.PropertySpec({
                    type: 'ResourcePool',
                    pathSet: ['parent', 'name']
                })]
            })
        ], vim.RetrieveOptions());
        console.log(JSON.stringify(targetObjects, null, 4));
        return vim.ManagedObjectReference({
            type: 'ResourcePool',
            value: 'test'
        });
    }

    public async GetSubnetIpOfVM(vmName: string, subnetIP: string, subnetMask: string): Promise<string[]> {
        let returnIps: string[] = [];
        let virtualMachine = await this.GetManagedObject(vmName, 'VirtualMachine', true);
        let guestInformation = await this.GetPropertyAny(virtualMachine, 'guest');
        for (let netInfo of guestInformation.net) {
            for (let ipAddress of netInfo.ipAddress) {
                // Check if ipv4
                if (ip.isV4Format(ipAddress)) {
                    let subnet = ip.subnet(subnetIP, subnetMask);
                    let cidrSubnet = subnetIP + '/' + subnet.subnetMaskLength;
                    if (ip.cidrSubnet(cidrSubnet).contains(ipAddress)) {
                        returnIps.push(ipAddress);
                    }
                }
            }
        }
        return returnIps;
    }

    /** Retrieve a managed object, ie. VM or datastore, using it's name and type.
     * @param {string} name - The name of the managed object.
     * @param {string} type - The type of the object. ie 'VirtualMachine'
     * @param {boolean} ignoreMissing - Default false. Will throw an exception if the object is not found when set to false.
     * @return {vspherevim.vimService.vim.ManagedObjectReference} A managed object reference.
     */
    public async GetManagedObject(name: string, type: string, ignoreMissing: boolean = false): Promise<vspherevim.vimService.vim.ManagedObjectReference> {
        let { serviceContent: {
            propertyCollector,
            rootFolder,
            viewManager
        }, vim, vimPort } = this.vimService;
        let containerView = await this.vimService.vimPort.createContainerView(viewManager, rootFolder, [type], true);
        let targetObjects = await vimPort.retrievePropertiesEx(propertyCollector, [
            vim.PropertyFilterSpec({
                objectSet: [vim.ObjectSpec({
                    obj: containerView,
                    skip: false,
                    selectSet: [vim.TraversalSpec({
                        path: 'view',
                        type: containerView.type
                    })]
                })],
                propSet: [vim.PropertySpec({
                    type: type,
                    pathSet: ['name', 'parent']
                })]
            })
        ], vim.RetrieveOptions());
        if (targetObjects === undefined) {
            if (ignoreMissing) { return null; }
            throw Error(`Unable to find object of type ${type} and name ${name} `);
        }
        let matchSet = targetObjects.objects.filter(p => p.propSet[0].val === name);
        if (matchSet.length === 0) {
            if (ignoreMissing) { return null; }
            throw Error(`Unable to find object of type ${type} and name ${name} `);
        }
        return vim.ManagedObjectReference({
            type: type,
            value: matchSet[0].obj.value
        });
    }

    /** Use this function to explore all the properties of a Managed Object. Mainly useful for diagnostics. */
    public async GetEverything(objectToInspect: vspherevim.vimService.vim.ManagedObjectReference): Promise<any> {
        let { serviceContent: {
            propertyCollector
        }, vim, vimPort } = this.vimService;
        let targetObjects = await vimPort.retrievePropertiesEx(propertyCollector, [
            vim.PropertyFilterSpec({
                objectSet: [vim.ObjectSpec({
                    obj: objectToInspect,
                    skip: false,
                    selectSet: [vim.TraversalSpec({
                        path: 'view',
                        type: 'ContainerView'
                    })]
                })],
                propSet: [vim.PropertySpec({
                    type: objectToInspect.type,
                    pathSet: [],
                    all: true
                })]
            })
        ], vim.RetrieveOptions());
        return targetObjects;
    }

    /** Get a single property of a managed object when the property is expected to be a simple value. */
    public async GetProperty(objectToInspect: vspherevim.vimService.vim.ManagedObjectReference, property: string): Promise<string> {
        let { serviceContent: {
            propertyCollector
        }, vim, vimPort } = this.vimService;
        let targetObjects = await vimPort.retrievePropertiesEx(propertyCollector, [
            vim.PropertyFilterSpec({
                objectSet: [vim.ObjectSpec({
                    obj: objectToInspect,
                    skip: false,
                    selectSet: [vim.TraversalSpec({
                        path: 'view',
                        type: 'ContainerView'
                    })]
                })],
                propSet: [vim.PropertySpec({
                    type: objectToInspect.type,
                    pathSet: [property]
                })]
            })
        ], vim.RetrieveOptions());
        return targetObjects.objects[0].propSet[0].val;
    }

    /** Get a single property of a managed object when the property is expected to be a complex object. */
    public async GetPropertyAny(objectToInspect: vspherevim.vimService.vim.ManagedObjectReference, property: string): Promise<any> {
        let { serviceContent: {
            propertyCollector
        }, vim, vimPort } = this.vimService;
        let targetObjects = await vimPort.retrievePropertiesEx(propertyCollector, [
            vim.PropertyFilterSpec({
                objectSet: [vim.ObjectSpec({
                    obj: objectToInspect,
                    skip: false,
                    selectSet: [vim.TraversalSpec({
                        path: 'view',
                        type: 'ContainerView'
                    })]
                })],
                propSet: [vim.PropertySpec({
                    type: objectToInspect.type,
                    pathSet: [property]
                })]
            })
        ], vim.RetrieveOptions());
        return targetObjects.objects[0].propSet[0].val;
    }

    /** Upload a file directly to a datastore on a host.
     * 
     */
    public UploadFileDirectlyToHost(ESXiHostAddress: string,
        localfilename: string,
        vmwarefilepath: string,
        dc: string,
        datastore: string,
        overfileFile = false): Promise<boolean> {
        var checkurl: string = '';
        return Promise.resolve().then(() => {
            checkurl = this.BuildUploadURL(ESXiHostAddress, vmwarefilepath, dc, datastore);
            return this.GetServiceTicket(checkurl, 'httpHead');
        })
            .then((serviceTicket) => {
                return checkDatastoreFileExists(checkurl, serviceTicket.id, this.UserSession.userAgent);
            })
            .then((fileExists) => {
                if (!fileExists) {
                    this.TaskManager.StartStep(true, 'Upload file', 'arrow_up_small');
                    let myUrl = this.BuildUploadURL(ESXiHostAddress, vmwarefilepath, dc, datastore);
                    return this.GetServiceTicket(myUrl, 'httpPut').then((serviceTicket) => {
                        return uploadHttpsFileProgress(this.TaskManager, myUrl, vmwarefilepath, serviceTicket.id, this.UserSession.userAgent, true);
                    }).then(() => {
                        this.TaskManager.FinishStep();
                        return Promise.resolve(true);
                    });
                } else {
                    console.log('File already exists on datastore.');
                    return Promise.resolve(true);
                }
            });
    }

    /** Constructs the URL for a file on a host. */
    private BuildUploadURL(EXSiHostAddress: string, filename: string, dc: string, datastore: string): string {
        return `https://${EXSiHostAddress}/folder${filename}?dcPath=${dc}&dsName=${datastore}`;
    }

    private GetServiceTicket(url: string, verb: string): Promise<vspherevim.vimService.vim.SessionManagerGenericServiceTicket> {
        let requestSpec: vspherevim.vimService.vim.SessionManagerHttpServiceRequestSpec = this.vimService.vim.SessionManagerHttpServiceRequestSpec(
            {
                method: verb,
                url: url
            });
        return this.vimService.vimPort.acquireGenericServiceTicket(this.SessionManager, requestSpec);
    }

    /** For a VM return it's parent host. */
    public async GetHostOfVM(virtualMachine: vspherevim.vimService.vim.ManagedObjectReference): Promise<vspherevim.vimService.vim.ManagedObjectReference> {
        let runtimeInfo = await this.GetPropertyAny(virtualMachine, 'runtime');
        let hostId = runtimeInfo['host'].value;
        return this.vimService.vim.ManagedObjectReference({
            type: 'HostSystem',
            value: hostId
        });
    }

    /** Returns the current running or not running state of the VM */
    public async IsVMRunning(vmName: string): Promise<boolean> {
        let virtualMachine = await this.GetManagedObject(vmName, 'VirtualMachine', true);
        if (virtualMachine === null) {
            throw Error('VM not found.');
        }
        let guestInformation = await this.GetPropertyAny(virtualMachine, 'guest');
        return (guestInformation.guestState === 'running');
    }

    /** Turn on a virtual machine. */
    public async TurnOnVM(vmName: string) {
        this.TaskManager.StartStep(false, `Turn on VM ${vmName}`, 'bulb');
        let virtualMachine = await this.GetManagedObject(vmName, 'VirtualMachine', true);
        if (virtualMachine === null) {
            throw Error('VM not found.');
        }
        let host = await this.GetHostOfVM(virtualMachine);
        await this.completeTask(this.vimService,
            await this.vimService.vimPort.powerOnVMTask(virtualMachine, host));
        this.TaskManager.FinishStep();
    }

    /** Turn off a virtual machine. Hard shutdown. Will wait till the machine is off. */
    public async TurnOffVM(vmName: string) {
        this.TaskManager.StartStep(false, `Turn off VM ${vmName}`, 'bulb');
        let virtualMachine = await this.GetManagedObject(vmName, 'VirtualMachine', true);
        if (virtualMachine === null) {
            throw Error('VM not found.');
        }
        await this.completeTask(this.vimService,
            await this.vimService.vimPort.powerOffVMTask(virtualMachine));
        this.TaskManager.FinishStep();
    }

    /** Turn off a virtual machine gracefully. */
    public async TurnOffVMGracefully(vmName: string) {
        this.TaskManager.StartStep(false, `Guest shutdown VM ${vmName}`, 'bulb');
        let virtualMachine = await this.GetManagedObject(vmName, 'VirtualMachine', true);
        if (virtualMachine === null) {
            throw Error('VM not found.');
        }
        await this.vimService.vimPort.shutdownGuest(virtualMachine);
        this.TaskManager.FinishStep();
    }

    /** Restart a vitual machine. */
    public async RestartVM(vmName: string) {
        this.TaskManager.StartStep(false, `Guest reboot VM ${vmName}`, 'bulb');
        let virtualMachine = await this.GetManagedObject(vmName, 'VirtualMachine', true);
        if (virtualMachine === null) {
            throw Error('VM not found.');
        }
        await this.vimService.vimPort.rebootGuest(virtualMachine);
        this.TaskManager.FinishStep();
    }

    /** Destory a virtual machine. */
    public async DestroyVM(vmName: string) {
        this.TaskManager.StartStep(false, `Destroy VM ${vmName}`, 'boom');
        let virtualMachine = await this.GetManagedObject(vmName, 'VirtualMachine', true);
        if (virtualMachine === null) {
            throw Error('VM not found.');
        }
        await this.completeTask(this.vimService,
            await this.vimService.vimPort.destroyTask(virtualMachine));
        this.TaskManager.FinishStep();
    }

    private async completeTask(vimService: vspherevim.vimService, task: vspherevim.vimService.vim.ManagedObjectReference) {
        let { serviceContent: {
            propertyCollector
        }, vim, vimPort } = vimService;
        let filter = await vimPort.createFilter(propertyCollector,
            vim.PropertyFilterSpec({
                objectSet: [vim.ObjectSpec({
                    obj: task,
                    skip: false
                })],
                propSet: [vim.PropertySpec({
                    type: task.type,
                    pathSet: ['info.state', 'info.error']
                })]
            }), true);
        let version = '';
        let waiting = true;
        while (waiting) {
            let updateSet = await vimPort.waitForUpdatesEx(propertyCollector,
                version, vim.WaitOptions());
            version = updateSet.version;
            updateSet.filterSet.
                filter(({ filter: { value } }) => value === filter.value).
                reduce((previous, { objectSet }) => [...previous, ...objectSet], []).
                reduce((previous, { changeSet }) => [...previous, ...changeSet], []).
                forEach(({ name, val }) => {
                    if (name === 'info.error' && val !== undefined) {
                        throw Error(val.localizedMessage);
                    }
                    if (name === 'info.state' && val === vim.TaskInfoState.success) {
                        waiting = false;
                    }
                });
        }
        await vimPort.destroyPropertyFilter(filter);
    }
}
