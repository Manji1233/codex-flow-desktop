---
name: video-studio
description: End-to-end local video editing and programmatic video creation using Remotion, HyperFrames, or FFmpeg. Use when Codex needs to cut or combine local video, image, and audio files; add captions, music, voiceovers, transitions, motion graphics, charts, or social-media layouts; turn a webpage into a video; or render a verified playable video file.
---

# Video Studio

Create a real playable output file. Never stop at a storyboard, code sample, or unrendered project when the user asked for a finished video.

## Workflow

1. Inspect the selected media and working directory without modifying the originals.
2. Confirm or infer the target aspect ratio, duration, resolution, captions, audio, and output format.
3. Choose the smallest suitable engine:
   - Use FFmpeg for cuts, concatenation, transcoding, audio mixing, overlays, speed changes, and format conversion.
   - Use Remotion for React-based motion graphics, kinetic text, charts, reusable compositions, and frame-accurate captions.
   - Use HyperFrames for HTML/CSS/GSAP compositions, website-to-video capture, voiceovers, and audio-reactive visuals.
4. Create project and output files inside the current workspace or the selected media directory.
5. Render the final video. If the preferred engine is unavailable, fall back to another installed engine instead of only describing the failure.
6. Verify that the output exists and is playable. Use `ffprobe` when available; otherwise verify file size and the renderer exit status.
7. Report the absolute output path, format, resolution, duration, engine used, and any remaining limitations.

## Safety

- Preserve source files and write to a new output path.
- Do not upload local media unless the user explicitly requests a remote service.
- Do not claim success before a render command completes and the output file is verified.
- Avoid copyrighted music or assets unless the user supplied them or confirmed usage rights.

Read [references/engine-selection.md](references/engine-selection.md) when the task could reasonably use more than one engine.
