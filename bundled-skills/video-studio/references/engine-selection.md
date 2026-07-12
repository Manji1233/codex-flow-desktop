# Engine Selection

## FFmpeg

Prefer FFmpeg for direct media operations with existing footage:

- Trim, split, concatenate, crop, scale, pad, rotate, stabilize, or change speed.
- Mix or replace audio, normalize loudness, burn subtitles, add image or text overlays.
- Convert containers and codecs or create delivery variants.

Use `ffprobe -v error -show_streams -show_format -of json <input>` to inspect inputs when available.

## Remotion

Prefer the official Remotion plugin for programmatic compositions:

- Animated captions, charts, title sequences, product demos, and social-media templates.
- React components, reusable timelines, transitions, 3D, and frame-accurate animation.
- Projects that benefit from previewing and iterating on a composition before rendering.

Use the installed Remotion plugin guidance for project structure and rendering commands.

## HyperFrames

Prefer the official HyperFrames by HeyGen plugin when HTML is the natural authoring format:

- Website-to-video capture, HTML/CSS/GSAP animation, kinetic typography, and landing-page promos.
- Voiceover, transcription, synced captions, and audio-reactive visuals supported by its workflow.

Use the installed HyperFrames plugin guidance for initialization, preview, capture, and rendering.

## Fallback Order

1. Use the engine explicitly requested by the user.
2. Otherwise choose the engine requiring the least new project setup.
3. If an engine or dependency is unavailable, preserve completed work and switch to the next suitable engine.
4. Always finish by rendering and verifying a playable file.
