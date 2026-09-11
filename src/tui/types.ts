export type NarrativeEventType = 'heard' | 'code' | 'git' | 'file' | 'warning' | 'error' | 'info';

export interface NarrativeEvent {
  text: string;
  type: NarrativeEventType;
  timestamp?: string;
}

export interface ActivityLogEntry {
  timestamp: string;
  tag: string;
  message: string;
  color?: string;
}

export interface CodeVoiceTuiCallbacks {
  onMuteToggle?: (isMuted: boolean) => void;
  onFileSwitch?: (newPath: string) => void;
  onQuit?: () => void;
}

export interface CodeVoiceView {
  init(): Promise<void>;
  setStatus(status: 'CONNECTING' | 'LISTENING' | 'PROCESSING' | 'MUTED' | 'ERROR'): void;
  updateLiveTranscript(text: string): void;
  setFinalTranscript(finalText: string, language?: string, rawText?: string, originalDevanagari?: string): void;
  recordHeard(text: string): void;
  recordAction(actionText: string, type?: NarrativeEventType): void;
  setActiveFile(newPath: string): void;
  getActiveFile(): string;
  logActivity(tag: string, message: string, color?: string): void;
  promptDestructiveConfirmation(keyword: string, rawTranscript: string): Promise<boolean>;
  openFileSwitchDialog?(): Promise<string | null>;
  dispose(): void;
}

