// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VoltzSTT",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "VoltzSTT",
            path: "Sources/VoltzSTT",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
