# vmware-coreos [![Build Status](https://travis-ci.org/mrgeoffrich/vmware-coreos.svg?branch=master)](https://travis-ci.org/mrgeoffrich/vmware-coreos)

This is a work in progress tool to assist in the automation of long running VMWare tasks for provisioning and managing coreos instances.

This also includes a set of tasks often required to automate, such as downloading files and interacting with the contents of VMWare datastores, plus running SSH commands to validate the state of running machines.

This can be run from the command line, or set up as a http server with callbacks.

## Global npm dependencies

```
npm install -g tslint mocha yarn gulp-cli
```

## Develop

To start development on this project run these commands:
```
yarn
gulp prepare
```

## Build

```
yarn
gulp
```

## Test

```
npm test
```


Note: Due to the licensing agreement with VMWare I can not redistribute the Javascript SDK as part of this repository.

## Runtime dependencies

* VCenter 6+ (due to the use of content libraries)
* At least one host, datastore and resource pool
* Internet access to download CoreOS images and to download the vmware javascript SDK.
* Nodejs >= 6.9

## Command line usage

### **env-create**

```
node ./build/src/index.js env-create environmentfile subnetfile vmwarehostfile
```

Creates a new set of virtual machines defined in the environmentfile. The subnet file defines any network configuration to apply to the new machines. The vmwarehostfile defines which vm host, datastore and resource pool the new machines will be provisioned.

Sample files are in the sample_files folder. These sample files will provision a single etcd server with a static IP and a pool of worker nodes.

### **env-destroy**

```
node ./build/src/index.js env-destroy environmentfile
```

Turns off and deletes all the VMs specified in the environmentfile.

### **env-off**

```
node ./build/src/index.js env-off environmentfile
```

Gracefully shuts down the machines specified in the environmentfile.

### **env-on**

```
node ./build/src/index.js env-on environmentfile
```

Turns on the machines specified in the environmentfile.

### **env-validate**

Still WIP. This will run commands to validate that an environment is in the correct expected state.

### **env-reconfigure**

Still WIP. This will change the coreos settings on already provisioned machines.

### **coreos-setup**

```
node ./build/src/index.js coreos-setup stream datastore libraryname
```

This command automates the setup of the coreos OVA file for use with env-create. Specify the stream ('stable','beta','alpha'), the datastore on vmware to store the files on and the content library name to use.

This needs to be run before env-create will work.


### **serve**

Still WIP. This will start up this application as a web server for integration with other systems.

## Definition Files

### Environment file

This file defines a name for an entire environment, along with a set of machines and their cloud init files. Static IPs can also be set here for various machines.

### Subnet file

This file defines networking configuration for servers, in terms of the subnet, DNS and gateway IPs to use. This is applied to an entire environment.

### VMWare host file

This file defines the host, datastore and resource pool to use when provisioning new machines.

### cloudinit files

These are the initialization files used by coreos when configuration is applied.

## Howto

Sample steps to provision a coreos environment:

* Clone this repo
* Ensure global dependences are installed
* Run build steps
* Copy the .credentials.json.sample file to .credentials.json and ensure the correct login settings have been entered for vcenter.
* Copy the files in sample_files folder to a new folder called deploy_files
* Add your own SSH key into the user-data yaml files.
* Edit the json files in the deploy_files folder. One file to define vm host specs, one file to define network settings and a larger file to define the contents of an environment.
* Run coreos-setup just once to setup the template.
* Run env-create with the previous definintions to create a new environment.
* Run env-destroy to remove the environment.

## Important Notes

This software uses:

* [vSphere SDK for Javascript](https://labs.vmware.com/flings/vsphere-sdk-for-javascript)

Useful related links:

* [CoreOS on VMware Configuration](https://coreos.com/os/docs/latest/vmware-guestinfo.html)
* [Official OVA file download location](https://coreos.com/os/docs/latest/booting-on-vmware.html)
