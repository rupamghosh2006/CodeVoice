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
  setFinalTranscript(finalText: string, language?: string, rawText?: string): void;
  setActiveFile(newPath: string): void;
  getActiveFile(): string;
  logActivity(tag: string, message: string, color?: string): void;
  promptDestructiveConfirmation(keyword: string, rawTranscript: string): Promise<boolean>;
  openFileSwitchDialog?(): Promise<string | null>;
  dispose(): void;
}
