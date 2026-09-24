// Product walkthrough video — registered ONLY after a real recording of the
// console exists (see scripts/record-console-walkthrough.mjs). While this is
// null the home page renders no video band at all: no placeholder reel, no
// stock footage, no mocked UI presented as the product.
export type ProductVideo = {
  mp4: string; // H.264
  webm: string; // VP9
  poster: string;
  captions: string; // WebVTT
  durationSec: number;
  recordedOn: string; // ISO date — shown under the video
};

export const productVideo: ProductVideo | null = null;
