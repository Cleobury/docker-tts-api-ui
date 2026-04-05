#!/bin/bash
# Rebuild script for Universal XTTSv2 API (Bash/WSL2)
# This script will stop/remove the existing container, rebuild the image, and start a fresh one.

IMAGE_NAME="my-universal-tts"
CONTAINER_NAME="docker-tts-api-ui"
# Get the absolute path of the directory where this script is located
PROJECT_PATH=$(pwd)

# 1. Stop and remove existing container if it exists
if [ $(docker ps -a -q -f name=^/${CONTAINER_NAME}$) ]; then
    echo "Stopping and removing existing container: ${CONTAINER_NAME}..."
    docker stop ${CONTAINER_NAME}
    docker rm ${CONTAINER_NAME}
fi

# 2. Build the new image
echo "Rebuilding Docker image: ${IMAGE_NAME}..."
docker build -t ${IMAGE_NAME} .

# 3. Create and start the new container
# Using $(pwd) to ensure absolute paths for volume mounts
echo "Starting new container: ${CONTAINER_NAME}..."
docker run -d -it -p 2902:2902 --gpus all --restart=unless-stopped \
    -e TORCH_FORCE_WEIGHTS_ONLY_LOAD=0 \
    -v "${PROJECT_PATH}:/shared" \
    -v "${PROJECT_PATH}/models:/root/.local/share/tts" \
    -v "/usr/lib/wsl/lib:/usr/lib/wsl/lib:ro" \
    --shm-size=8gb \
    --name ${CONTAINER_NAME} ${IMAGE_NAME}

echo "Success! The TTS API should be running at http://localhost:2902"
echo "Monitoring logs (Press Ctrl+C to stop, the container will continue to run)..."
docker logs -f ${CONTAINER_NAME}
