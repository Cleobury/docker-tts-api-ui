# Rebuild script for Universal XTTSv2 API (PowerShell)
# This script will stop/remove the existing container, rebuild the image, and start a fresh one.

$ImageName = "my-universal-tts"
$ContainerName = "docker-tts-api-ui"
$ProjectPath = $PSScriptRoot

# 1. Stop and remove existing container if it exists
if (docker ps -a --format '{{.Names}}' | Select-String -Quiet "^$ContainerName$") {
    Write-Host "Stopping and removing existing container: $ContainerName..." -ForegroundColor Yellow
    docker stop $ContainerName
    docker rm $ContainerName
}

# 2. Build the new image
Write-Host "Rebuilding Docker image: $ImageName..." -ForegroundColor Cyan
docker build -t $ImageName .

# 3. Create and start the new container
Write-Host "Starting new container: $ContainerName..." -ForegroundColor Green
docker run -d -it -p 2902:2902 --gpus all --restart=unless-stopped `
    -e TORCH_FORCE_WEIGHTS_ONLY_LOAD=0 `
    -v "$($ProjectPath):/shared" `
    -v "$($ProjectPath)\models:/root/.local/share/tts" `
    -v "/usr/lib/wsl/lib:/usr/lib/wsl/lib:ro" `
    --shm-size=8gb `
    --name $ContainerName $ImageName

Write-Host "Success! The TTS API should be running at http://localhost:2902" -ForegroundColor Green
Write-Host "Monitoring logs (Press Ctrl+C to stop monitoring, the container will keep running)..." -ForegroundColor Cyan
docker logs -f $ContainerName
