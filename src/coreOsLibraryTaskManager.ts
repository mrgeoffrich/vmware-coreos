import { VMWare } from './vmware';
import { CoreOsHelper } from './coreOsHelper';
import { Credentials } from './credentials';
import { TaskManager, TaskManagerOutputType, ITaskManager } from './taskManager';

export class CoreOsLibraryTaskManager {
    public async CheckAndSetCoreOsLibrary(datastoreName: string, contentLibraryName: string, coreOsStream: string = 'stable') {
        let taskManger: ITaskManager = new TaskManager(TaskManagerOutputType.Console, 'Setup Core OS Library Item');
        try {
            taskManger.StartAll();
            let vcenter = new VMWare(taskManger);
            let creds: Credentials = new Credentials('.credentials.json');
            let coreos = new CoreOsHelper(vcenter, taskManger);
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            await coreos.SetupCoreOsContentLibrary(datastoreName, contentLibraryName);
            await coreos.SetupCoreOsContentItem(coreOsStream);
            await vcenter.Disconnect();
            taskManger.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManger.Error(ex);
            process.exit(1);
        }
    }
}