
export type DeviceKind = "video" | "audio" | "none";

export type DeviceClassification =
  | "physical"
  | "virtual"
  | "unknown";

export interface DirectShowDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  classification: DeviceClassification;
  alternativeName?: string;
}

export interface CameraDevice {
  id: string;
  name: string;
  manufacturer?: string;
  type: "usb" | "network";
  connected: boolean;
}

export interface AudioDevice {
  id: string;
  name: string;
  type: "microphone";
  connected: boolean;
}

export interface CameraAssignment {
  cameraId: string;
  audioDeviceId?: string;
  displayName: string;
  division?: string;
}
