#!/bin/sh
# Operator-only build asset. This does not install or activate a runner.
set -eu
umask 022

if [ "$#" -ne 1 ]; then
  echo "usage: build-runtime.sh <new-output-directory>" >&2
  exit 2
fi
runner_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -- "$1"
build_dir=$(CDPATH= cd -- "$1" && pwd)
export PATH=/usr/bin:/bin LC_ALL=C SOURCE_DATE_EPOCH=1790313668
unset CFLAGS CPPFLAGS LDFLAGS LIBS PKG_CONFIG_PATH PKG_CONFIG_LIBDIR LD_PRELOAD LD_LIBRARY_PATH

curl -fL --proto '=https' --tlsv1.2 \
  https://github.com/containers/crun/releases/download/1.30.1/crun-1.30.1.tar.gz \
  -o "$build_dir/source.tar.gz"
printf '%s  %s\n' 99d036d95113552b6df66c7c879432835504bf0e525fc0372745071df129527b "$build_dir/source.tar.gz" | sha256sum --check --status
tar -xzf "$build_dir/source.tar.gz" -C "$build_dir"
cd "$build_dir/crun-1.30.1"
patch --batch --fuzz=0 -p1 < "$runner_dir/crun.patch"
env -i PATH="$PATH" LC_ALL=C SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  CC=/usr/bin/cc CFLAGS='-O2 -g0' \
  ./configure --disable-systemd --disable-criu --disable-shared > "$build_dir/configure.log" 2>&1
env -i PATH="$PATH" LC_ALL=C SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  make -j2 > "$build_dir/make.log" 2>&1
install -m 0555 crun "$build_dir/crun"
cd "$build_dir"
{
  ./crun --version
  /usr/bin/cc --version
  dpkg-query -W libc6 libc6-dev libcap2 libcap-dev libjson-c5 libjson-c-dev libseccomp2 libseccomp-dev binutils make
  sha256sum crun source.tar.gz "$runner_dir/crun.patch"
  ldd crun
} > receipt.txt
echo "Runtime candidate built at $build_dir/crun. No installation or activation."
