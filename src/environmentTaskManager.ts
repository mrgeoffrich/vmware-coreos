import { VMWare } from './vmware';
import { CoreOsHelper, CoreOSServerConfig } from './coreOsHelper';
import { Credentials } from './credentials';
import { TaskManager, TaskManagerOutputType, ITaskManager } from './taskManager';
import { SubnetDefinition } from './subnetDefinition';
import { VmwareHostDefinition } from './vmwareHostDefinition';
import { EnvironmentDefinition } from './environmentDefinition';
import { ValidationSpecDefinition } from './validationSpecDefinition';
import { validate } from './validationPromise';
import * as leftPad from 'left-pad';
export class EnvironmentTaskManager {

    private CreateServerName(environmentName: string, roleName: string, serverNumber: number) {
        return environmentName + '-' + roleName + '-' + leftPad((serverNumber + 1), 2, '0');
    }
    public async DeployEnvironment(subnetConfiguration: SubnetDefinition,
        hostConfiguration: VmwareHostDefinition,
        environmentDefinition: EnvironmentDefinition,
        coreOsStream: string = 'stable',
        coreOsContentLibraryName: string = 'coreos') {
        let taskManager: ITaskManager = new TaskManager(TaskManagerOutputType.Console, `Create ${environmentDefinition.Name}`);
        try {
            taskManager.StartAll();
            let vcenter = new VMWare(taskManager);
            let creds: Credentials = new Credentials('.credentials.json');
            let coreos = new CoreOsHelper(vcenter, taskManager);
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            await coreos.GetCoreOsContentLibrary(coreOsContentLibraryName);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    let newCoreOSconfig = new CoreOSServerConfig(vmName);
                    if (role.StaticIP !== undefined) {
                        newCoreOSconfig.SetStaticIP(role.StaticIP, subnetConfiguration.GatewayIP, subnetConfiguration.SubnetMask);
                        newCoreOSconfig.DNS = subnetConfiguration.DNSServers;
                    } else {
                        newCoreOSconfig.SetDCHP();
                        newCoreOSconfig.DNS = subnetConfiguration.DNSServers;
                    }
                    newCoreOSconfig.LoadCloudConfigFromFile(role.CloudInitSource, role.CloudInitReplace);
                    await coreos.DeployCoreOSVM(coreOsStream, vmName, hostConfiguration.ResourcePool, hostConfiguration.Host, hostConfiguration.Datastore);
                    await vcenter.ReconfigureVM(vmName, newCoreOSconfig.GetGuestinfoSettings());
                    await vcenter.TurnOnVM(vmName);
                }
            }
            await vcenter.Disconnect();
            taskManager.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManager.Error(ex);
            process.exit(1);
        }
    }

    public async DestroyEnvironment(environmentDefinition: EnvironmentDefinition) {
        let taskManager: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Destroy environment');
        try {
            taskManager.StartAll();
            let vcenter = new VMWare(taskManager);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    await vcenter.TurnOffVM(vmName);
                    await vcenter.DestroyVM(vmName);
                }
            }
            await vcenter.Disconnect();
            taskManager.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManager.Error(ex);
            process.exit(1);
        }
    }

    public async TurnOnEnvironment(environmentDefinition: EnvironmentDefinition) {
        let taskManager: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Turn on environment');
        try {
            taskManager.StartAll();
            let vcenter = new VMWare(taskManager);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    await vcenter.TurnOnVM(vmName);
                }
            }
            await vcenter.Disconnect();
            taskManager.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManager.Error(ex);
            process.exit(1);
        }
    }

    public async TurnOffEnvironment(environmentDefinition: EnvironmentDefinition) {
        let taskManager: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Turn off environment');
        try {
            taskManager.StartAll();
            let vcenter = new VMWare(taskManager);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    await vcenter.TurnOffVMGracefully(vmName);
                }
            }
            await vcenter.Disconnect();
            taskManager.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManager.Error(ex);
            process.exit(1);
        }
    }

    public async ValidateEnvironment(environmentDefinition: EnvironmentDefinition,
        subnetConfiguration: SubnetDefinition,
        validationDefintion: ValidationSpecDefinition,
        username: string,
        password: string) {
        let taskManager: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Validate environment');
        try {
            taskManager.StartAll();
            let vcenter = new VMWare(taskManager);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    // Get the IP address of this VM
                    let ipAddresses = await vcenter.GetSubnetIpOfVM(vmName, subnetConfiguration.SubnetIP, subnetConfiguration.SubnetMask);
                    taskManager.StartStep(false, 'Validate IP of ' + vmName, '');
                    if (ipAddresses.length > 1) {
                        taskManager.FinishStepFail('Server has multiple IP addresses.');
                    }
                    if (ipAddresses.length === 1) {
                        taskManager.FinishStep();
                        // Iterate through validation steps
                        for (let validationStep of validationDefintion.ValidationCommands) {
                            if (validationStep.Roles.indexOf(role.Name) >= 0) {
                                taskManager.StartStep(false, validationStep.Description, 'ballot_box_with_check');
                                let validationResult = await validate(ipAddresses[0], username, password, validationStep.Command);
                                if (validationStep.Type === 'expected-output') {
                                    if (validationResult.Output.indexOf(validationStep.Value) >= 0) {
                                        taskManager.FinishStep();
                                    } else {
                                        taskManager.FinishStepFail();
                                    }
                                } else {
                                    taskManager.FinishStepFail('Unknown validation type');
                                }
                            }
                        }
                    }
                    if (ipAddresses.length === 0) {
                        taskManager.FinishStepFail('Server has no IP addresses.');
                    }
                }
            }
            await vcenter.Disconnect();
            taskManager.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManager.Error(ex);
            process.exit(1);
        }
    }

    public async ReconfigureEnvironment(environmentDefinition: EnvironmentDefinition, subnetConfiguration: SubnetDefinition) {
        let taskManager: ITaskManager = new TaskManager(TaskManagerOutputType.Console, `Create ${environmentDefinition.Name}`);
        try {
            taskManager.StartAll();
            let vcenter = new VMWare(taskManager);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    let newCoreOSconfig = new CoreOSServerConfig(vmName);
                    if (role.StaticIP !== undefined) {
                        newCoreOSconfig.SetStaticIP(role.StaticIP, subnetConfiguration.GatewayIP, subnetConfiguration.SubnetMask);
                        newCoreOSconfig.DNS = subnetConfiguration.DNSServers;
                    } else {
                        newCoreOSconfig.SetDCHP();
                        newCoreOSconfig.DNS = subnetConfiguration.DNSServers;
                    }
                    newCoreOSconfig.LoadCloudConfigFromFile(role.CloudInitSource, role.CloudInitReplace);
                    await vcenter.ReconfigureVM(vmName, newCoreOSconfig.GetGuestinfoSettings());
                    await vcenter.RestartVM(vmName);
                }
            }
            await vcenter.Disconnect();
            taskManager.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManager.Error(ex);
            process.exit(1);
        }
    }
}