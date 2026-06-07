---
layout: post
title: 🇬🇧 Reverse Engineering a Commercial AI Stem Separation Application
author: voidm4p
date: 2026-06-07 09:00:00
categories:
- reverse-engineering
- machine-learning
tags:
- reverse-engineering
- onnx
- flutter
- frida
- dsp
- ai
- music
- onnxruntime
toc: true
---

# Reverse Engineering a Commercial AI Stem Separation Application

> Disclaimer: This article discusses reverse engineering techniques and architectural observations. Proprietary model weights, URLs, keys, internal identifiers and copyrighted assets have been intentionally redacted. References to the vendor, product, model and internal symbols are replaced with **[REDACTED]**.

## Introduction

Recently I spent some time reverse engineering a commercial AI-powered stem separation application. The objective was to understand how the offline processing pipeline actually worked.

The investigation ultimately covered:

- Flutter and Dart AOT internals
- Native macOS frameworks
- Frida instrumentation
- ONNX Runtime
- DSP reconstruction
- Experimental validation against ground truth

The most interesting lesson was that the neural network itself was not the difficult part. The difficult part was separating assumptions from facts.

## Initial Reconnaissance

The target application is a Flutter-based macOS application.

Enumerating the application bundle immediately revealed several interesting components:

- Flutter runtime
- Native processing frameworks
- ONNX Runtime
- FFmpeg components
- Audio processing libraries

Inspection of exported symbols showed a thin native bridge layer and a separate framework implementing the actual DSP and inference pipeline.

The presence of ONNX Runtime strongly suggested that inference was performed locally rather than in the cloud.

## Recovering the Flutter Layer

The first instinct was to recover as much information as possible from the Dart layer.

The application uses Flutter on macOS, ARM64 binaries, Dart 3.11.x and no-compressed-pointers.

Blutter does not support this configuration particularly well out of the box, so several patches and workarounds were required before it could successfully process the application.

The recovered output contained:

- Hundreds of generated Dart files
- Class metadata
- Object pools
- Method signatures
- FFI definitions

At first this looked promising.

However, after reviewing the reconstructed code it became obvious that most of the interesting functionality was not implemented in Flutter.

The Dart layer was useful for:

- Understanding application flow
- Recovering string constants
- Identifying native bridges
- Recovering model download references

But the actual inference pipeline lived elsewhere.

Looking back, getting Blutter working was valuable mostly because it helped identify where *not* to spend time.

## Dead End #1: The Transformation Happens in Dart

The first working hypothesis was that the downloaded model artifact was decrypted or transformed inside the Dart runtime.

This assumption seemed reasonable.

The download logic was present in Flutter.

The native frameworks did not obviously expose cryptographic functionality.

Unfortunately, the hypothesis was wrong.

## Runtime Instrumentation

Rather than continuing to reason about static code, the investigation shifted toward runtime observation.

Frida proved invaluable.

Hooking the model initialization path revealed that the Flutter layer simply downloaded the model artifact and passed initialization parameters into native code.

The downloaded file and the cached file on disk were byte-identical.

The transformation occurred entirely inside the native layer.

This observation completely changed the direction of the investigation.

## Finding the Model

The Flutter object pool contained references to a proprietary model artifact downloaded from a static location.

Basic triage revealed:

- No ONNX headers
- No protobuf structures
- No compression signatures
- No meaningful strings

The file appeared intentionally transformed.

Entropy analysis produced a value of approximately 7.95 bits per byte.

This suggested that the file was either compressed, encrypted or obfuscated.

## Dead End #2: AES

Entropy measurements initially suggested encryption.

However, byte-frequency analysis told a different story.

The distribution exhibited visible bias and did not resemble strongly encrypted content.

No convincing evidence of AES ever appeared.

## Dead End #3: Compression

The next hypothesis was compression.

Again, further analysis disproved the theory.

Neither signatures nor structure matched known compressed formats.

## What Actually Happened

Runtime instrumentation revealed that native code received both the model path and initialization material required to transform the model.

Comparing the original file against the in-memory representation revealed a deterministic byte-level transformation.

The protection mechanism ultimately relied on a repeating XOR operation.

The difficult part was not understanding the algorithm.

The difficult part was finding where it was applied.

## Recovering the ONNX Graph

Once the transformation was understood, the resulting artifact could be inspected as a standard ONNX model.

Inspection revealed:

- Multi-stem architecture
- Conditional execution paths
- ONNX Runtime inference
- TFC-TDF style building blocks
- Independent stem generation branches

One particularly interesting design choice was the use of ONNX control-flow operators.

The top-level graph consisted largely of conditional execution nodes controlling independent stem-specific networks.

This allows the application to execute only the stems requested by the user.

## Understanding the Model Structure

The model input shape immediately revealed several implementation details.

The tensor layout strongly suggested:

- Stereo processing
- Complex spectrogram representation
- Real and imaginary components stored explicitly
- Frequency-domain inference

Rather than producing masks, the model appears to emit estimated complex spectrograms directly.

This distinction becomes important later.

## Reconstructing the DSP Pipeline

Understanding the model itself was insufficient.

The neural network expects very specific inputs.

The surrounding DSP pipeline therefore became the next target.

Decompilation of the native framework revealed references consistent with:

- FFT size 4096
- Hop size 1024
- Chunk-based processing
- Complex spectrogram representations

The pipeline appeared roughly as follows:

Input Audio → STFT → Chunking → Neural Network → ISTFT → Output Stem

## Dead End #4: Hamming Windows

This became one of the most educational mistakes of the project.

The decompiled implementation strongly suggested a Hamming window.

The constants appeared correct.

The implementation appeared correct.

Everything pointed toward Hamming.

Yet reconstructed stems consistently contained subtle artifacts.

The problem was not the reconstruction code.

The problem was the assumption.

## Ground Truth Beats Decompiled Code

Fortunately, stem separation applications provide something extremely valuable:

Ground truth.

The application itself exports stems to disk.

Those outputs can be compared directly against independently reconstructed pipelines.

A/B testing quickly revealed that a Hann window produced significantly better agreement with the application's outputs than a Hamming window.

This became one of the most important lessons of the investigation:

> Decompiled code is evidence. It is not ground truth.

## Dead End #5: Mask-Based Reconstruction

Another incorrect assumption involved output reconstruction.

Initially, a mask-based workflow seemed attractive.

Applying ratio masks reduced certain artifacts but introduced a new problem:

- Stem bleed
- Energy redistribution
- Reduced separation quality

Comparing against the application's own outputs showed that the model output was being used directly rather than converted into masks.

The masking hypothesis was wrong.

## Chunking Strategy

Further experimentation revealed that chunking behaviour was just as important as FFT parameters.

Edge regions of convolutional models are less reliable than central regions.

The reconstruction pipeline therefore benefits from selecting outputs where frames are most central to a given chunk rather than averaging overlapping predictions indiscriminately.

This observation produced significantly better agreement with the application's outputs.

## ONNX Control Flow and GPU Acceleration

One particularly interesting discovery involved performance.

The model relies heavily on ONNX `If` nodes.

These control-flow operators significantly limit execution-provider delegation and can force large portions of inference back onto the CPU.

Extracting individual branch graphs into standalone ONNX models allowed substantially better acceleration using providers such as:

- CoreML
- CUDA
- DirectML

While preserving output equivalence.

## Lessons Learned

Several recurring themes emerged throughout the investigation.

### Runtime Analysis Beats Static Analysis

Most important discoveries came from observing execution.

Not from reading pseudocode.

### Decompilers Produce Hypotheses

Not facts.

Every assumption must be validated experimentally.

### The Hard Part Wasn't the Neural Network

Most effort went into:

- Data flow analysis
- DSP reconstruction
- Runtime instrumentation
- Validation

### Ground Truth Is King

Whenever theory and reality disagreed, reality won.

## Conclusion

This project began as an attempt to understand how a commercial offline stem separation application worked.

What emerged was a reminder that modern AI applications are still software systems.

The techniques required to understand them are often the same techniques used daily in malware analysis, vulnerability research and software reverse engineering:

- Follow the data.
- Observe execution.
- Validate assumptions.
- Trust measurements.

The neural network may have been the protected asset.

But the most interesting reverse engineering challenges were everything surrounding it.
