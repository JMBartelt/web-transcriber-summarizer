# wavtools

wavtools is a library for both recording and streaming Waveform Audio (.wav) data
in the browser. It is intended for managing PCM16 audio streams directly.

This is a fork of open source, MIT licensed tooling initially
developed at OpenAI as part of the [OpenAI Realtime Console](https://github.com/openai/openai-realtime-console), developed by [Keith Horwood](https://x.com/keithwhor).

The two most important classes are the `WavRecorder` used for capturing audio
in the browser, and `WavStreamPlayer` for queueing and streaming audio chunks to the user.

## Installation and usage

To install wavtools in a Webpack project;

```shell
$ npm i wavtools --save
```

```javascript
import { WavRecorder, WavStreamPlayer } from 'wavtools';

const wavRecorder = new WavRecorder({ sampleRate: 24000 });
wavRecorder.getStatus(); // "ended"
```

To use as a standalone script, download the [script/wavtools.js](/script/wavtools.js) or
[script/wavtools.min.js](/script/wavtools.js) files and import them;

```html
<script src="/script/wavtools.js"></script>
<script>
  // works as part of `window` object
  const wavRecorder = new WavRecorder({ sampleRate: 24000 });
  wavRecorder.getStatus(); // "ended"
</script>
```

## WavRecorder Quickstart

```javascript
import { WavRecorder } from 'wavtools';

const wavRecorder = new WavRecorder({ sampleRate: 24000 });
wavRecorder.getStatus(); // "ended"

// request permissions, connect microphone
await wavRecorder.begin();
wavRecorder.getStatus(); // "paused"

// Start recording
// This callback will be triggered in chunks of 8192 samples by default
// { mono, raw } are Int16Array (PCM16) mono & full channel data
await wavRecorder.record((data) => {
  const { mono, raw } = data;
});
wavRecorder.getStatus(); // "recording"

// Stop recording
await wavRecorder.pause();
wavRecorder.getStatus(); // "paused"

// outputs "audio/wav" audio file
const audio = await wavRecorder.save();

// clears current audio buffer and starts recording
await wavRecorder.clear();
await wavRecorder.record();

// get data for visualization
const frequencyData = wavRecorder.getFrequencies();

// Stop recording, disconnects microphone, output file
await wavRecorder.pause();
const finalAudio = await wavRecorder.end();

// Listen for device change; e.g. if somebody disconnects a microphone
// deviceList is array of MediaDeviceInfo[] + `default` property
wavRecorder.listenForDeviceChange((deviceList) => {});
```

## WavStreamPlayer Quickstart

```javascript
import { WavStreamPlayer } from '/src/lib/wavtools/index.js';

const wavStreamPlayer = new WavStreamPlayer({ sampleRate: 24000 });

// Connect to audio output
await wavStreamPlayer.connect();

// Create 1s of empty PCM16 audio
const audio = new Int16Array(24000);
// Queue 3s of audio, will start playing immediately
wavStreamPlayer.add16BitPCM(audio, 'my-track');
wavStreamPlayer.add16BitPCM(audio, 'my-track');
wavStreamPlayer.add16BitPCM(audio, 'my-track');

// get data for visualization
const frequencyData = wavStreamPlayer.getFrequencies();

// Interrupt the audio (halt playback) at any time
// To restart, need to call .add16BitPCM() again
const trackOffset = await wavStreamPlayer.interrupt();
trackOffset.trackId; // "my-track"
trackOffset.offset; // sample number
trackOffset.currentTime; // time in track
```

# Compilation

When modifying the repository, to create appropriate TypeScript types and
JavaScript bundles, use `npm run compile`.

## Running the demo server

This repository also includes a simple Express application for recording audio
in the browser and submitting it to OpenAI for transcription and summarization.
To start the server locally:

```bash
npm install
npm start
```

By default the server runs on port `3000`. Make sure your `OPENAI_API_KEY`
environment variable is set before starting so that requests to the OpenAI API
succeed.

# Acknowledgements and contact

Thanks to the OpenAI Realtime team! Without their awesome work this library would not
be needed.

- OpenAI Developers / [@OpenAIDevs](https://x.com/OpenAIDevs)
- Jordan Sitkin / API / [@dustmason](https://x.com/dustmason)
- Mark Hudnall / API / [@landakram](https://x.com/landakram)
- Peter Bakkum / API / [@pbbakkum](https://x.com/pbbakkum)
- Atty Eleti / API / [@athyuttamre](https://x.com/athyuttamre)
- Jason Clark / API / [@onebitToo](https://x.com/onebitToo)
- Karolis Kosas / Design / [@karoliskosas](https://x.com/karoliskosas)
- Romain Huet / DX / [@romainhuet](https://x.com/romainhuet)
- Katia Gil Guzman / DX / [@kagigz](https://x.com/kagigz)
- Ilan Bigio / DX / [@ilanbigio](https://x.com/ilanbigio)
- Kevin Whinnery / DX / [@kevinwhinnery](https://x.com/kevinwhinnery)

You can reach me directly at;

- Keith Horwood / [@keithwhor](https://x.com/keithwhor)
