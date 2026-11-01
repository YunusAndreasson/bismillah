# The phone app's toolchain, sourced only by mobile/run.sh, so that desktop and stick
# builds keep using the system's Rust (mobile/PLAN.md, M0).
toolchain=$HOME/.local/share/bismillah-mobile
export RUSTUP_HOME=$toolchain/rustup
export CARGO_HOME=$toolchain/cargo
export PATH=$CARGO_HOME/bin:$PATH
export ANDROID_HOME=/opt/android-sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.1.12297006
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
