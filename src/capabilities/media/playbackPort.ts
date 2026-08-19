export type MediaPlaybackState =
  | 'loading'
  | 'playing'
  | 'paused'
  | 'interrupted'
  | 'stopped'
  | 'failed'

export type MediaPlaybackStatus = Readonly<{
  currentTimeSeconds: number
  durationSeconds: number | null
  state: MediaPlaybackState
}>

export type MediaPlaybackRequest = Readonly<{
  artist?: string
  callerSubjectId: string
  maxDurationSeconds: number
  signal: AbortSignal
  title: string
  url: string
}>

export interface MediaPlaybackPort {
  pause(): Promise<void>
  resume(): Promise<void>
  start(
    request: MediaPlaybackRequest,
    onStatus: (status: MediaPlaybackStatus) => void,
  ): Promise<void>
  stop(): Promise<void>
}

export interface MediaPlaybackPortFactory {
  create(): MediaPlaybackPort
  probe(): Promise<boolean>
}
