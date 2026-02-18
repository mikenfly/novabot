#!/bin/bash
# Build the NovaBot agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="novabot-agent"
TAG="${1:-latest}"

echo "Building NovaBot agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

# Auto-detect container runtime
if command -v docker &> /dev/null && docker info &> /dev/null; then
  echo "Using Docker..."
  docker build -t "${IMAGE_NAME}:${TAG}" .
elif command -v container &> /dev/null; then
  echo "Using Apple Container..."
  container build -t "${IMAGE_NAME}:${TAG}" .
else
  echo "Error: No container runtime found (Docker or Apple Container)"
  exit 1
fi

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
if command -v docker &> /dev/null && docker info &> /dev/null; then
  echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | docker run -i ${IMAGE_NAME}:${TAG}"
else
  echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | container run -i ${IMAGE_NAME}:${TAG}"
fi
