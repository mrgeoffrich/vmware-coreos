import * as commander from 'commander';
import { EnvironmentTaskManager } from './environmentTaskManager';
import { CoreOsLibraryTaskManager } from './coreOsLibraryTaskManager';
import { SubnetDefinition } from './subnetDefinition';
import { VmwareHostDefinition } from './vmwareHostDefinition';
import { EnvironmentDefinition } from './environmentDefinition';
import * as fs from 'fs';
import * as path from 'path';

// Ignore SSL errors all day
// Perhaps global settings for these - using nconf
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

commander
    .version('0.0.1')
    .option('-l, --library <name>', 'Set the name of the library to store the coreos OVA. Defaults to coreos.')
    .option('-s, --stream <stream>', 'Set the coreos stream to use. Defaults to stable.');

commander.command('coreos-setup <datastore> <libraryname>')
    .description('Set up coreos ova ready for deploymeny.')
    .action(async (datastore, libraryname) => {
        await new CoreOsLibraryTaskManager().CheckAndSetCoreOsLibrary(datastore, libraryname);
    });

commander.command('env-create <environmentfile> <subnetfile> <vmwarehostfile>')
    .description('Create a new environment.')
    .action(async (environmentfile, subnetfile, vmwarehostfile) => {
        let envFileContents = JSON.parse(fs.readFileSync(path.resolve(environmentfile), 'utf8'));
        let subnetFileContents = JSON.parse(fs.readFileSync(path.resolve(subnetfile), 'utf8'));
        let vmwareFileContents = JSON.parse(fs.readFileSync(path.resolve(vmwarehostfile), 'utf8'));
        let subnetConfiguration: SubnetDefinition = {
            GatewayIP: subnetFileContents.GatewayIP,
            DNSServers: subnetFileContents.DNSServers,
            SubnetIP: subnetFileContents.SubnetIP,
            SubnetMask: subnetFileContents.SubnetMask
        };
        let hostConfiguration: VmwareHostDefinition = {
            Host: vmwareFileContents.Host,
            Datastore: vmwareFileContents.Datastore,
            ResourcePool: vmwareFileContents.ResourcePool
        };
        let environmentDefinition: EnvironmentDefinition = {
            Name: envFileContents.Name,
            Description: envFileContents.Description,
            Machines: envFileContents.Machines
        };
        await new EnvironmentTaskManager().DeployEnvironment(subnetConfiguration, hostConfiguration, environmentDefinition);
    });

commander.command('env-on <environmentfile>')
    .description('Turn on all the machines in an environment')
    .action(async (environmentfile) => {
        let envFileContents = JSON.parse(fs.readFileSync(path.resolve(environmentfile), 'utf8'));
        let environmentDefinition: EnvironmentDefinition = {
            Name: envFileContents.Name,
            Description: envFileContents.Description,
            Machines: envFileContents.Machines
        };
        await new EnvironmentTaskManager().TurnOnEnvironment(environmentDefinition);
    });

commander.command('env-off <environmentfile>')
    .description('Gracefully turn off all the machines in an environment')
    .action(async (environmentfile) => {
        let envFileContents = JSON.parse(fs.readFileSync(path.resolve(environmentfile), 'utf8'));
        let environmentDefinition: EnvironmentDefinition = {
            Name: envFileContents.Name,
            Description: envFileContents.Description,
            Machines: envFileContents.Machines
        };
        await new EnvironmentTaskManager().TurnOffEnvironment(environmentDefinition);
    });

commander.command('env-destroy <environmentfile>')
    .description('Destroy an environment.')
    .action(async (environmentfile) => {
        let envFileContents = JSON.parse(fs.readFileSync(path.resolve(environmentfile), 'utf8'));
        let environmentDefinition: EnvironmentDefinition = {
            Name: envFileContents.Name,
            Description: envFileContents.Description,
            Machines: envFileContents.Machines
        };
        await new EnvironmentTaskManager().DestroyEnvironment(environmentDefinition);
    });

commander.command('env-reconfigure <environmentfile>')
    .description('Re-apply configuration on VMs and restart them all.')
    .action(async (environmentfile) => {
        let envFileContents = JSON.parse(fs.readFileSync(path.resolve(environmentfile), 'utf8'));
        let environmentDefinition: EnvironmentDefinition = {
            Name: envFileContents.Name,
            Description: envFileContents.Description,
            Machines: envFileContents.Machines
        };
        //TODO: Implement
    });

commander.command('env-validate <environmentdefinition> <subnetfile> <validationspec>')
    .description('Validate that an environment is running correctly.')
    .action(async (environmentfile, subnetfile, validationspec) => {
        let envFileContents = JSON.parse(fs.readFileSync(path.resolve(environmentfile), 'utf8'));
        let subnetFileContents = JSON.parse(fs.readFileSync(path.resolve(subnetfile), 'utf8'));
        let subnetConfiguration: SubnetDefinition = {
            GatewayIP: subnetFileContents.GatewayIP,
            DNSServers: subnetFileContents.DNSServers,
            SubnetIP: subnetFileContents.SubnetIP,
            SubnetMask: subnetFileContents.SubnetMask
        };
        let environmentDefinition: EnvironmentDefinition = {
            Name: envFileContents.Name,
            Description: envFileContents.Description,
            Machines: envFileContents.Machines
        };
        await new EnvironmentTaskManager().ValidateEnvironment(environmentDefinition, subnetConfiguration);
    });

commander.command('serve')
    .description('Start a http server to serve task requests')
    .action(() => {
        // Run a http server which will perform the same operations as the command line options.
        // Note: Use swagger spec defined in swagger.yaml.
    });

if (!process.argv.slice(2).length) {
    commander.outputHelp();
} else {
    commander.parse(process.argv);
}