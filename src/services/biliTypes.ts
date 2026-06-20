export interface VideoInfo {
  bvid: string
  aid: number
  audioUrl?: string
  title: string
  desc: string
  pic: string
  ownerName: string
  ownerMid: number
  duration: number
  cid: number
  stat: {
    view: number
    like: number
    favorite: number
  }
}
