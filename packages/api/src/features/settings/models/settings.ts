export interface ApplicationSettingExported {
  template: {
    sections: SettingsSection[];
    items: SettingsMapItem[];
  };
  data: ApplicationSettingsData[];
}

export interface ApplicationSettingsData {
  key: string;
  value: string;
  isEncrypted: boolean;
  description?: string;
}

export interface SettingsSection {
  key: string;
  label: string;
}

export interface SettingsMapItem {
  section: string;
  label: string;
  key: string;
  valueFrom: string;
  encrypted: boolean;
  default: any;
  type: 'text' | 'password' | 'checkbox';
  required?: boolean;
  requiredIf?: string;
  requiredIfValue?: any;
  pattern?: string;
  patternMessage?: string;
}
