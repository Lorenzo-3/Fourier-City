# Fourier City

Fourier City is an interactive Three.js audio visualization. Walk around the scene, choose a generated waveform or an MP3, adjust its pitch and filters, and watch the skyline react to the frequency spectrum.

## Requirements

- Node.js 24
- npm 11

## Setup

```sh
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`.

## Commands

- `npm run dev` starts the development server.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves the production build locally.
- `npm test` runs the Node test suite.

## Controls

- `WASD`: move
- `Shift`: sprint
- Mouse: look around and aim at controls
- Click: press waveform, music, and filter buttons
- Drag knobs: adjust pitch, cutoff, gain, and resonance
- `Space`: stop or resume playback

## Structure

- `src/`: application code organized by domain
- `tests/`: unit tests mirroring the source domains
- `public/assets/`: audio, environment maps, images, and 3D models
- `docs/`: project notes and supporting documentation

The application is assembled in `src/main.js`. Stateful behavior is owned by domain controllers; mathematical and visualization helpers remain small testable modules.

## Asset Attribution

The repository does not currently record the original authors or licenses for the bundled audio, image, HDRI, and model assets. Confirm and document their provenance before redistributing or publishing the project.
