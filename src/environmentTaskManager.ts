import { VMWare } from './vmware';
import { CoreOsHelper, CoreOSServerConfig } from './coreOsHelper';
import { Credentials } from './credentials';
import { TaskManager, TaskManagerOutputType, ITaskManager } from './taskManager';
import { SubnetDefinition } from './subnetDefinition';
import { VmwareHostDefinition } from './vmwareHostDefinition';
import { EnvironmentDefinition } from './environmentDefinition';
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
        let taskManger: ITaskManager = new TaskManager(TaskManagerOutputType.Console, `Create ${environmentDefinition.Name}`);
        try {
            taskManger.StartAll();
            let vcenter = new VMWare(taskManger);
            let creds: Credentials = new Credentials('.credentials.json');
            let coreos = new CoreOsHelper(vcenter, taskManger);
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
            taskManger.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManger.Error(ex);
            process.exit(1);
        }
    }

    public async DestroyEnvironment(environmentDefinition: EnvironmentDefinition) {
        let taskManger: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Destroy environment');
        try {
            taskManger.StartAll();
            let vcenter = new VMWare(taskManger);
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
            taskManger.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManger.Error(ex);
            process.exit(1);
        }
    }

    public async TurnOnEnvironment(environmentDefinition: EnvironmentDefinition) {
        let taskManger: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Turn on environment');
        try {
            taskManger.StartAll();
            let vcenter = new VMWare(taskManger);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    await vcenter.TurnOnVM(vmName);
                }
            }
            await vcenter.Disconnect();
            taskManger.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManger.Error(ex);
            process.exit(1);
        }
    }

    public async TurnOffEnvironment(environmentDefinition: EnvironmentDefinition) {
        let taskManger: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Turn off environment');
        try {
            taskManger.StartAll();
            let vcenter = new VMWare(taskManger);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    await vcenter.TurnOffVMGracefully(vmName);
                }
            }
            await vcenter.Disconnect();
            taskManger.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManger.Error(ex);
            process.exit(1);
        }
    }

    public async ValidateEnvironment(environmentDefinition: EnvironmentDefinition, subnetConfiguration: SubnetDefinition, username: string, password: string) {
        let taskManger: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Validate environment');
        try {
            taskManger.StartAll();
            let vcenter = new VMWare(taskManger);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            for (let role of environmentDefinition.Machines) {
                for (var i = 0; i < role.Count; i++) {
                    let vmName = this.CreateServerName(environmentDefinition.Name, role.Name, i);
                    // Get the IP address of this VM
                    let ipAddresses = await vcenter.GetSubnetIpOfVM(vmName, subnetConfiguration.SubnetIP, subnetConfiguration.SubnetMask);
                    if (ipAddresses.length > 1) {
                        console.log('Server has multiple IP addresses that match that subnet');
                    }
                    if (ipAddresses.length === 1) {
                        if (role.Name === 'etcd') {
                            let clusterHealth = await validate(ipAddresses[0], username, password, 'etcdctl cluster-health');
                            if (clusterHealth.Output.indexOf('cluster is health') >= 0) {
                                console.log('etcd ok ' + ipAddresses[0]);
                            } else {
                                console.log('error');
                            }
                        }
                        if (role.Name === 'worker') {
                            let clusterHealth = await validate(ipAddresses[0], username, password, 'sudo systemctl is-active docker');
                            if (clusterHealth.Output.indexOf('active') >= 0) {
                                console.log('docker ok ' + ipAddresses[0]);
                            } else {
                                console.log('error');
                            }
                        }
                    }
                    if (ipAddresses.length === 0) {
                        console.log('No matching IP addresses');
                    }
                }
            }
            await vcenter.Disconnect();
            taskManger.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManger.Error(ex);
            process.exit(1);
        }
    }

    public async ReconfigureEnironment(environmentDefinition: EnvironmentDefinition, subnetConfiguration: SubnetDefinition) {
        let taskManger: ITaskManager = new TaskManager(TaskManagerOutputType.Console, `Create ${environmentDefinition.Name}`);
        try {
            taskManger.StartAll();
            let vcenter = new VMWare(taskManger);
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
            taskManger.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManger.Error(ex);
            process.exit(1);
        }
    }
}