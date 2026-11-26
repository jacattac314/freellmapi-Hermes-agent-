import { makeColors } from './make-colors.js'

type Def = Parameters<typeof makeColors>[0]

export const SKINS: Record<string, Def> = {
  paper: {
    label: 'Paper',
    roles: { accent: '#2f5d8c', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
    light: { gray: { anchors: { 'surface-0': '#efe6d3', 'surface-1': '#f4ecdc', 'surface-2': '#faf5e9', 'text-primary': '#2a241d', 'text-secondary': '#544a3d', 'text-muted': '#6a5f50' } } },
    dark: { gray: { anchors: { 'surface-0': '#1f1a15', 'surface-1': '#28221b', 'surface-2': '#312a22', 'surface-3': '#3a3229', 'text-primary': '#f0e7d7', 'text-secondary': '#cfc4b2', 'text-muted': '#aca08d' } } },
  },
  nord: {
    label: 'Nord',
    roles: { accent: '#5e81ac', danger: '#bf616a', success: '#a3be8c', warning: '#d08770', pro: '#b48ead' },
    codeTheme: { dark: 'nord' },
    light: { gray: { anchors: { 'surface-0': '#e5e9f0', 'surface-1': '#eceff4', 'surface-2': '#f4f6f9', 'text-primary': '#2e3440', 'text-secondary': '#3b4252', 'text-muted': '#4c566a' } } },
    dark: { gray: { anchors: { 'surface-0': '#2e3440', 'surface-1': '#343b48', 'surface-2': '#3b4252', 'surface-3': '#3e4553', 'text-primary': '#eceff4', 'text-secondary': '#d8dee9', 'text-muted': '#b4bccb' } } },
  },
  forest: {
    label: 'Forest',
    roles: { accent: '#2f7d5b', danger: '#b5473a', success: '#4f8a2e', warning: '#b07d1a', pro: '#7a5c99' },
    light: { gray: { anchors: { 'surface-0': '#e4ebe2', 'surface-1': '#ecf1ea', 'surface-2': '#f4f7f2', 'text-primary': '#1d2a20', 'text-secondary': '#3a4a3d', 'text-muted': '#55655a' } } },
    dark: { gray: { anchors: { 'surface-0': '#141c17', 'surface-1': '#1a241d', 'surface-2': '#202c23', 'surface-3': '#24312a', 'text-primary': '#e3ece4', 'text-secondary': '#c2cfc4', 'text-muted': '#9fb0a3' } } },
  },
  synthwave: {
    label: 'Synthwave',
    only: 'dark',
    roles: { accent: '#ff4fd8', danger: '#ff5c7a', success: '#3ef0b5', warning: '#ffcc4d', pro: '#9b7bff' },
    dark: { gray: { anchors: { 'surface-0': '#160f2b', 'surface-1': '#1d1538', 'surface-2': '#241b44', 'surface-3': '#281e4a', 'text-primary': '#f4eaff', 'text-secondary': '#d6c6f0', 'text-muted': '#b2a1d4' } } },
  },
}
