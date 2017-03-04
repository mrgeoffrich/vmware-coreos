import * as uuid from 'uuid';
import * as emoji from 'node-emoji';
import * as leftPad from 'left-pad';
import * as progress from 'progress';
import * as padright from 'pad-right';

interface TaskStep {
    Description: string;
    Icon: string;
    StepNumber: number;
    StartTime: [number, number];
    StartProgress(totalProgressAmount: number);
    TickProgress(tickAmount: number);
    LogStart();
    LogDone(resultText?: string);
    LogFail(resultText?: string);
    LogError(errorText: string);
}

class TaskStepConsoleOut implements TaskStep {
    public Description: string;
    public Icon: string;
    public StepNumber: number;
    private Bar: any;
    public StartTime: [number, number];
    constructor() {
        this.StartTime = process.hrtime();
    }
    public StartProgress(totalProgressAmount: number) {
        this.Bar = new progress('[:bar] :percent :etas', {
            complete: emoji.get('black_medium_square'),
            incomplete: emoji.get('white_medium_square'),
            width: 20,
            total: totalProgressAmount,
            renderThrottle: 1000
        });
    }

    public TickProgress(tickAmount: number) {
        this.Bar.tick(tickAmount);
    }

    public LogStart() {
        let emojiDisplay = emoji.get(this.Icon);
        process.stdout.write('[' + leftPad(this.StepNumber, 2, '0') + '] ' + emojiDisplay + '  ' + padright(this.Description, 50, ' '));
    }

    public LogDone(resultText?: string) {
        let emojiDisplay = emoji.get('white_check_mark');
        process.stdout.write(' ' + emojiDisplay);
        if (resultText !== undefined) {
            process.stdout.write('  - ' + resultText);
        }
        process.stdout.write('\n');
    }
    public LogFail(resultText?: string) {
        let emojiDisplay = emoji.get('x');
        process.stdout.write(' ' + emojiDisplay);
        if (resultText !== undefined) {
            process.stdout.write('  - ' + resultText);
        }
        process.stdout.write('\n');
    }

    public LogError(errorText: string) {
        let emojiDisplay = emoji.get('x');
        process.stdout.write(' ' + emojiDisplay + '\n');
        process.stdout.write(errorText + '\n');
    }
}

export interface ITaskManager {
    Id: string;
    Steps: TaskStep[];
    StartAll();
    StartStep(hasProgress: boolean, stepText: string, stepIcon: string, progressTotal?: number);
    TickStep(tickAmount: number);
    FinishStep(resultText?: string);
    FinishStepFail(resultText?: string);
    FinishAll();
    Error(errorText: string);
    StartProgress(totalProgressAmount: number);
}

export enum TaskManagerOutputType {
    Console,
    HttpCallback
}

export class TaskManager implements ITaskManager {
    public Id: string;
    public Steps: TaskStep[];
    private outputType: TaskManagerOutputType;
    private taskListDescription: string;
    private startTime: [number, number];
    private lastStepHasFinished = false;
    constructor(outputType: TaskManagerOutputType, taskListDescription: string) {
        this.Id = uuid();
        this.Steps = [];
        this.outputType = outputType;
        this.taskListDescription = taskListDescription;
    }

    public StartAll() {
        if (this.outputType === TaskManagerOutputType.Console) {
            this.StartStep(false, 'Begin ' + this.taskListDescription, 'sunny');
        } else if (this.outputType === TaskManagerOutputType.HttpCallback) {
            // Do a http get/post/whatevs
        }

        this.startTime = process.hrtime();
    }

    public StartStep(hasProgress: boolean, stepText: string, stepIcon: string) {
        if (!this.lastStepHasFinished && this.Steps.length > 0) {
            // Finish the last step if it hasn't been finished.
            this.FinishStep();
        }
        let newStep: TaskStep;
        if (this.outputType === TaskManagerOutputType.Console) {
            newStep = new TaskStepConsoleOut();
        } else if (this.outputType === TaskManagerOutputType.HttpCallback) {
            // Do a http get/post/whatevs
        }
        newStep.Icon = stepIcon;
        newStep.Description = stepText;
        newStep.StepNumber = this.Steps.length + 1;
        this.Steps.push(newStep);
        newStep.LogStart();
        this.lastStepHasFinished = false;
    }

    public StartProgress(totalProgressAmount: number) {
        this.Steps[this.Steps.length - 1].StartProgress(totalProgressAmount);
    }

    public TickStep(tickAmount: number) {
        this.Steps[this.Steps.length - 1].TickProgress(tickAmount);
    }

    public FinishStep(resultText?: string) {
        this.Steps[this.Steps.length - 1].LogDone(resultText);
        this.lastStepHasFinished = true;
    }

    public FinishStepFail(resultText?: string, resultOk: boolean = true) {
        this.Steps[this.Steps.length - 1].LogFail(resultText);
        this.lastStepHasFinished = true;
    }

    public Error(errorText: string) {
        this.Steps[this.Steps.length - 1].LogError(errorText);
    }

    public FinishAll() {
        let elapsed = process.hrtime(this.startTime);
        if (this.outputType === TaskManagerOutputType.Console) {
            process.stdout.write(`Completed in ${elapsed[0]} seconds\n`);
        } else if (this.outputType === TaskManagerOutputType.HttpCallback) {
            // Do a http get/post/whatevs
        }
    }
}