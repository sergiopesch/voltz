import AVFoundation
import Foundation
import Speech

// Parse CLI arguments
var silenceTimeout: Double = 1.5
var maxDuration: Double = 30.0

let args = CommandLine.arguments
for i in 0..<args.count {
    if args[i] == "--silence", i + 1 < args.count {
        silenceTimeout = Double(args[i + 1]) ?? 1.5
    }
    if args[i] == "--max-duration", i + 1 < args.count {
        maxDuration = Double(args[i + 1]) ?? 30.0
    }
}

// Request authorization
let semaphore = DispatchSemaphore(value: 0)
var authorized = false

SFSpeechRecognizer.requestAuthorization { status in
    authorized = status == .authorized
    semaphore.signal()
}
semaphore.wait()

guard authorized else {
    let json = #"{"error": "Speech recognition not authorized. Grant permission in System Settings > Privacy & Security > Speech Recognition."}"#
    FileHandle.standardOutput.write(Data((json + "\n").utf8))
    exit(1)
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
      recognizer.isAvailable
else {
    let json = #"{"error": "Speech recognizer not available"}"#
    FileHandle.standardOutput.write(Data((json + "\n").utf8))
    exit(1)
}

let audioEngine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true

let inputNode = audioEngine.inputNode
let recordingFormat = inputNode.outputFormat(forBus: 0)

var lastSpeechTime = Date()
var bestTranscription = ""
var hasReceivedSpeech = false

let recognitionTask = recognizer.recognitionTask(with: request) { result, error in
    if let result = result {
        bestTranscription = result.bestTranscription.formattedString
        if !bestTranscription.isEmpty {
            hasReceivedSpeech = true
            lastSpeechTime = Date()
        }
    }

    if error != nil || (result?.isFinal ?? false) {
        audioEngine.stop()
        inputNode.removeTap(onBus: 0)
    }
}

inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
    request.append(buffer)
}

audioEngine.prepare()
do {
    try audioEngine.start()
} catch {
    let json = #"{"error": "Failed to start audio engine: \#(error.localizedDescription)"}"#
    FileHandle.standardOutput.write(Data((json + "\n").utf8))
    exit(1)
}

// Signal that we're listening
let readyJson = #"{"status": "listening"}"#
FileHandle.standardOutput.write(Data((readyJson + "\n").utf8))

let startTime = Date()

// Poll for silence or max duration
while true {
    Thread.sleep(forTimeInterval: 0.1)

    let elapsed = Date().timeIntervalSince(startTime)
    if elapsed >= maxDuration {
        break
    }

    if hasReceivedSpeech {
        let silenceDuration = Date().timeIntervalSince(lastSpeechTime)
        if silenceDuration >= silenceTimeout {
            break
        }
    }
}

// Stop recording
request.endAudio()
audioEngine.stop()
inputNode.removeTap(onBus: 0)
recognitionTask.cancel()

// Output result
let text = bestTranscription.trimmingCharacters(in: .whitespacesAndNewlines)
if text.isEmpty {
    let json = #"{"text": null, "final": true}"#
    FileHandle.standardOutput.write(Data((json + "\n").utf8))
} else {
    // Escape text for JSON
    let escaped = text
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
    let json = #"{"text": "\#(escaped)", "final": true}"#
    FileHandle.standardOutput.write(Data((json + "\n").utf8))
}

exit(0)
