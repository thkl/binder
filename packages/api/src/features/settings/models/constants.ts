import { SettingsMapItem, SettingsSection } from "./settings";

export const settingsSections: SettingsSection[] = [
  {
    key: 'common',
    label: 'Common Settings',
  },
  {
    key: 'mailer',
    label: 'Mailer Settings',
  },
  {
    key: 'oidc',
    label: 'SSO/OIDC Login',
  },
];

export const settingsMap: SettingsMapItem[] = [
    {
    key: 'oidc.ISSUER_URL',
    valueFrom: 'OIDC_ISSUER_URL',
    encrypted: false,
    default: '',
    label: 'Issuer',
    type: 'text',
    required: true,
    section: 'oidc',
  },
  {
    key: 'oidc.CLIENT_ID',
    valueFrom: 'OIDC_CLIENT_ID',
    encrypted: false,
    default: '',
    label: 'Client ID',
    type: 'text',
    required: true,
    section: 'oidc',
  },
  {
    key: 'oidc.CLIENT_SECRET',
    valueFrom: 'OIDC_CLIENT_SECRET',
    encrypted: true,
    default: '',
    label: 'Client Secret',
    type: 'password',
    required: true,
    section: 'oidc',
  },
  {
    key: 'oidc.REDIRECT_URI',
    valueFrom: 'OIDC_REDIRECT_URI',
    encrypted: false,
    default: '',
    label: 'Redirect URL',
    type: 'text',
    required: true,
    section: 'oidc',
  },
  {
    key: 'oidc.email_verified',
    valueFrom: 'email_verified',
    encrypted: false,
    default: false,
    label: 'Only accept verified eMails',
    type: 'checkbox',
    section: 'oidc',
  },
  {
    key: 'oidc.ACR_VALUES',
    valueFrom: 'acrValues',
    encrypted: false,
    default: '',
    label: 'Pass ACR Values if needed',
    type: 'text',
    section: 'oidc',
  },
   {
    key: 'frontend.url',
    valueFrom: 'frontendurl',
    encrypted: false,
    default: '',
    label: 'URL of the Application',
    type: 'text',
    section: 'common',
  },
]
