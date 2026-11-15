export type DeviceKind = "video" | "audio" | "none";
export type DeviceClassification = "physical" | "virtual" | "unknown";
export interface DirectShowDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  classification: DeviceClassification;
  alternativeName?: string;
}
