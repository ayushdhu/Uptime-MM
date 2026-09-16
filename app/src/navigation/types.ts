export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Sync: undefined;
  UnregisteredTag: {tagId: string};
  SetupWizard: {tagId?: string};
  Machine: {machineId: string};
  Walkthrough: {inspectionId: string};
  HighSeverityFlow: {inspectionId: string};
  Checkout: {inspectionId: string};
  Report: {inspectionId: string};
  InspectionDetail: {inspectionId: string};
  PhotoBrowser: {machineId: string};
};
