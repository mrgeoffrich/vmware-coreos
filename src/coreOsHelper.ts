import { downloadHttpsFileProgress } from './downloadHttpsProgress';
import { untarFile } from './untarProgress';
import { VMWare, GuestinfoConfigSetting } from './vmware';
import { ITaskManager } from './taskManager';
import * as tmp from 'tmp';
import * as path from 'path';
import * as glob from 'glob';
import * as fs from 'fs';
import * as btoa from 'btoa';
import * as ip from 'ip';

interface ContentLibraryTemplate {
    Channel: string;
    IsAvailable: boolean;
    HasBeenValidated: boolean;
}

export interface CoreOSNetInterfaceConfig {
    Name: string;
    DHCP: string; // 'yes' or 'no'
    Role: string; // 'private' or 'public'
    Gateway?: string;
    Destination?: string;
    IPAddress?: string;

}

export interface CloudConfigReplacement {
    Name: string;
    ReplaceValue: string;
}

export class CoreOSServerConfig {
    public Hostname: string;
    private ConfigData: string;
    public DNS: string[] = [];
    private ConfigDataEncoding: string; // 'base64' or 'gzip+base64'
    private NetworkInterfaces: CoreOSNetInterfaceConfig[] = [];

    constructor(hostname: string) {
        this.Hostname = hostname;
    }

    public LoadCloudConfigFromFile(filename: string, replacementValues: CloudConfigReplacement[] = []) {
        this.ConfigDataEncoding = 'base64';
        let cloudConfig = fs.readFileSync(filename);
        this.ConfigData = cloudConfig.toString();
        for (let replaceVal of replacementValues) {
            this.ConfigData = this.ConfigData.replace(`##${replaceVal.Name}##`, replaceVal.ReplaceValue);
        }
        this.ConfigData = btoa(this.ConfigData);
    }

    public SetDCHP() {
        this.NetworkInterfaces = [];
        this.NetworkInterfaces.push({ Name: 'ens192', DHCP: 'yes', Role: 'private' });
    }

    public SetStaticIP(ipAddress: string, gateway: string, subnetMask: string) {
        this.NetworkInterfaces = [];
        let subNetInfo = ip.subnet(ipAddress, subnetMask);
        this.NetworkInterfaces.push({
            Name: 'ens192',
            DHCP: 'no',
            Role: 'private',
            Gateway: gateway,
            IPAddress: `${ipAddress}/${subNetInfo.subnetMaskLength}`,
            Destination: '0.0.0.0/0'
        });
    }

    private AddNetworkGuestinfoSettings(returnGuestinfo: GuestinfoConfigSetting[]) {
        let interfaceNumber = 0;
        for (let networkinterface of this.NetworkInterfaces) {
            let interfacePrefix = `guestinfo.interface.${interfaceNumber}.`;
            if (networkinterface.Name !== undefined) {
                returnGuestinfo.push({ key: interfacePrefix + 'name', value: networkinterface.Name });
            }
            if (networkinterface.DHCP !== undefined) {
                returnGuestinfo.push({ key: interfacePrefix + 'DHCP', value: networkinterface.DHCP });
            }
            if (networkinterface.Role !== undefined) {
                returnGuestinfo.push({ key: interfacePrefix + 'role', value: networkinterface.Role });
            }
            if (networkinterface.IPAddress !== undefined) {
                returnGuestinfo.push({ key: interfacePrefix + 'ip.0.address', value: networkinterface.IPAddress });
            }
            if (networkinterface.Destination !== undefined) {
                returnGuestinfo.push({ key: interfacePrefix + 'route.0.destination', value: networkinterface.Destination });
            }
            if (networkinterface.Gateway !== undefined) {
                returnGuestinfo.push({ key: interfacePrefix + 'route.0.gateway', value: networkinterface.Gateway });
            }
            interfaceNumber += 1;
        }
        let dnsNumber = 0;
        for (let dns of this.DNS) {
            returnGuestinfo.push({ key: `guestinfo.dns.server.${dnsNumber}`, value: dns });
            dnsNumber += 1;
        }
    }

    public GetGuestinfoSettings(): GuestinfoConfigSetting[] {
        let returnGuestinfo: GuestinfoConfigSetting[] = [];
        returnGuestinfo.push({ key: 'guestinfo.hostname', value: this.Hostname });
        this.AddNetworkGuestinfoSettings(returnGuestinfo);
        if (this.DNS !== undefined) {

        }
        returnGuestinfo.push({ key: 'guestinfo.coreos.config.data.encoding', value: this.ConfigDataEncoding });
        returnGuestinfo.push({ key: 'guestinfo.coreos.config.data', value: this.ConfigData });
        return returnGuestinfo;
    }
}

export class CoreOsHelper {

    private vcenter: VMWare;
    private contentLibraryName: string;
    private contentLibraryDatastore: string;
    private contentLibraryReady: boolean = false;
    private contentLibraryId: string;
    private templates: { [channel: string]: ContentLibraryTemplate } = {};

    private channels = ['stable', 'beta', 'alpha'];
    private coreOsDownloadFilename: string = 'coreos_production_vmware_ova.ova';
    private taskManager: ITaskManager;

    constructor(vcenter: VMWare, taskManager: ITaskManager) {
        this.vcenter = vcenter;
        this.taskManager = taskManager;
        for (let channel of this.channels) {
            let add = { Channel: channel, IsAvailable: null, HasBeenValidated: false };
            this.templates[channel] = add;
        };
    }

    private TemplateName(channel: string): string {
        return `coreos-${channel}`;
    }

    private TemplateDescription(channel: string): string {
        return `Core OS ${channel} channel`;
    }

    private CoreOsDownloadUrl(channel: string): string {
        return `https://${channel}.release.core-os.net/amd64-usr/current/coreos_production_vmware_ova.ova`;
    }

    public async SetupCoreOsContentLibrary(datastoreName: string, contentLibraryName: string) {
        try {
            this.contentLibraryName = contentLibraryName;
            this.contentLibraryDatastore = datastoreName;
            let datastore = await this.vcenter.GetManagedObject(datastoreName, 'Datastore');
            this.contentLibraryId = await this.vcenter.ContentLibraryExistsAndCreate(this.contentLibraryName, datastore);
            this.contentLibraryReady = true;
            for (let channel of this.channels) {
                let contentItemExists = await this.vcenter.LibraryItemExists(this.contentLibraryId, this.TemplateName(channel));
                this.templates[channel].IsAvailable = contentItemExists;
                this.templates[channel].HasBeenValidated = true;
            };
        } catch (error) {
            this.taskManager.Error(error);
        }
    }

    public async GetCoreOsContentLibrary(contentLibraryName: string) {
        try {
            this.contentLibraryName = contentLibraryName;
            this.contentLibraryId = await this.vcenter.ContentLibraryExists(this.contentLibraryName);
            this.contentLibraryReady = true;
            for (let channel of this.channels) {
                let contentItemExists = await this.vcenter.LibraryItemExists(this.contentLibraryId, this.TemplateName(channel));
                this.templates[channel].IsAvailable = contentItemExists;
                this.templates[channel].HasBeenValidated = true;
            };
        } catch (error) {
            this.taskManager.Error(error);
        }
    }

    public async DeployCoreOSVM(channel: string, vmName: string,
        resourcePoolName: string,
        hostname?: string,
        datastorename?: string) {
        this.taskManager.StartStep(false, 'Validate CoreOS can be deployed', 'mag_right');
        if (this.channels.indexOf(channel) === -1) {
            throw ('Invalid channel');
        }
        if (!this.contentLibraryReady) {
            throw ('Content library is not configured. Please configure via the SetupCoreOsContentLibrary method');
        }
        if (!this.templates[channel].IsAvailable) {
            throw ('The template for channel ' + channel + ' is not available for deployment.');
        }
        let resourcePool = await this.vcenter.GetManagedObject(resourcePoolName, 'ResourcePool');
        let host = await this.vcenter.GetManagedObject(hostname, 'HostSystem');
        let datastore = await this.vcenter.GetManagedObject(datastorename, 'Datastore');
        let checkVmExists = await this.vcenter.GetManagedObject(vmName, 'VirtualMachine', true);
        if (checkVmExists === null) {
            this.taskManager.FinishStep();
            await this.vcenter.DeployOva(this.contentLibraryId, this.TemplateName(channel), vmName, resourcePool, datastore, host);
        } else {
            this.taskManager.FinishStep('VM already exists');
        }
    }

    public async SetupCoreOsContentItem(channel: string) {
        this.taskManager.StartStep(false, 'Validate CoreOS content can be setup', 'mag_right');
        if (this.channels.indexOf(channel) === -1) {
            throw Error('Invalid channel');
        }
        if (!this.contentLibraryReady) {
            throw Error('Content library is not configured. Please configure via the SetupCoreOsContentLibrary method');
        }
        if (!this.templates[channel].HasBeenValidated) {
            throw Error('The template for channel ' + channel + ' has not been validated.');
        }
        this.taskManager.FinishStep();
        this.taskManager.StartStep(false, 'Setup content library item for CoreOS OVA', 'wrench');
        let contentItemExists = await this.vcenter.LibraryItemExists(this.contentLibraryId, this.TemplateName(channel));
        if (!contentItemExists) {
            this.taskManager.FinishStep();
            // Download, untar and import
            let tempResult = tmp.dirSync();
            let tmpPath = tempResult.name;
            let localfilepath = path.join(tmpPath, this.coreOsDownloadFilename);
            let coreOsDownloadUrl = this.CoreOsDownloadUrl(channel);
            this.taskManager.StartStep(true, 'Download CoreOS OVA', 'arrow_down_small');
            try {
                let downloadReturn = await downloadHttpsFileProgress(this.taskManager, coreOsDownloadUrl, localfilepath, false);
                if (!downloadReturn.fileDownloadComplete) {
                    throw ('Download failed');
                }
                this.taskManager.FinishStep();
                this.taskManager.StartStep(true, 'Untar OVA', 'eight_spoked_asterisk');
                await untarFile(this.taskManager, localfilepath, tmpPath, true);
                let vmdkFilename: string;
                let ovfFilename: string;
                let vmdkFiles = glob.sync(path.join(tmpPath, '*.vmdk'));
                if (vmdkFiles.length === 0) {
                    throw ('No vmdk file extracted from OVA file that was downloaded');
                }
                vmdkFilename = path.parse(vmdkFiles[0]).base;
                let ovfFiles = glob.sync(path.join(tmpPath, '*.ovf'));
                if (ovfFiles.length === 0) {
                    throw ('No ovf file extracted from OVA file that was downloaded');
                }
                ovfFilename = path.parse(ovfFiles[0]).base;
                this.taskManager.FinishStep();
                await this.vcenter.UploadOVAContentsToLibrary(this.contentLibraryId, ovfFilename, vmdkFilename, tmpPath, this.TemplateName(channel), this.TemplateDescription(channel));
                this.templates[channel].IsAvailable = true;
            } catch (err) {
                this.taskManager.Error(err);
            }
            // Clean up
            let allFile = glob.sync(path.join(tmpPath, '*'));
            for (let removeFile of allFile) {
                fs.unlinkSync(removeFile);
            }
            tempResult.removeCallback();
        } else {
            this.taskManager.FinishStep('Content item already exists');
        }
    }

}