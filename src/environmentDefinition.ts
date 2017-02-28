export interface EnvironmentRoleDefinition {
    Name: string;
    Count: number;
    CloudInitSource: string;
    StaticIP?: string;
    CloudInitReplace?: [{ Name: string, ReplaceValue: string }];
}

export interface EnvironmentDefinition {
    Name: string;
    Description: string;
    Machines: [EnvironmentRoleDefinition];
}