import { VMWare } from './vmware';
import { Credentials } from './credentials';
import { TaskManager, TaskManagerOutputType, ITaskManager } from './taskManager';

export class VmwareTaskManager {
    public async ValidateCredentials() {
        let taskManager: ITaskManager = new TaskManager(TaskManagerOutputType.Console, `Validate VCenter Credentials`);
        try {
            taskManager.StartAll();
            let vcenter = new VMWare(taskManager);
            let creds: Credentials = new Credentials('.credentials.json');
            await vcenter.Connect(creds.Host, creds.Username, creds.Password);
            await vcenter.Disconnect();
            taskManager.FinishAll();
            process.exit(0);
        } catch (ex) {
            taskManager.Error(ex);
            process.exit(1);
        }
    }
}