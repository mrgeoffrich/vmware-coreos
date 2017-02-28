import { ITaskManager, TaskManager, TaskManagerOutputType } from '../src/taskManager';
import { expect } from 'chai';
import 'mocha';

describe('Hello function', () => {
  it('should return hello world', () => {
    let taskManager: ITaskManager;
    taskManager = new TaskManager(TaskManagerOutputType.Console, 'test tasks');
    expect(taskManager.Id).to.equal('Hello World!');
  });
});