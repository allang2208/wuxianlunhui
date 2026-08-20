$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$generator = Join-Path $root "comfyui-gen.py"
$model = "flux2-klein-4b-world122-building-depth"
$hostName = "192.168.3.142"
$loraName = "klein-world122-building-style-v1.safetensors"
$deadline = (Get-Date).AddHours(2)
$desktop = [Environment]::GetFolderPath("Desktop")
$work = Join-Path $root "_church_research_rework_20260819"
$log = Join-Path $work "lora_candidate_generation.log"

function Write-Log([string]$message) {
    "$(Get-Date -Format s) $message" | Add-Content -LiteralPath $log -Encoding utf8
}

Write-Log "Waiting for $loraName to load on $hostName."
while ((Get-Date) -lt $deadline) {
    try {
        $nodes = Invoke-RestMethod -Uri "http://$hostName`:8188/object_info" -TimeoutSec 10
        $loraOptions = @($nodes.LoraLoaderModelOnly.input.required.lora_name[0])
        if ($loraOptions -contains $loraName) { break }
    } catch {
        # ComfyUI is expected to be offline during training and restarting after deployment.
    }
    Start-Sleep -Seconds 30
}

if ((Get-Date) -ge $deadline) {
    Write-Log "Timed out before the trained LoRA became available."
    exit 1
}

$jobs = @(
    @{
        Name = "教堂"
        Prompt = Join-Path $work "prompts\church_user_prompt.txt"
        Control = Join-Path $work "reference_controls\church_exact_foundation_barracks_ref.png"
        Output = Join-Path $desktop "World122-教堂-LoRA候选.png"
        Bg = "#00FFFF"
        Seed = 819272
    },
    @{
        Name = "研究院"
        Prompt = Join-Path $work "prompts\research_institute_user_prompt.txt"
        Control = Join-Path $work "reference_controls\research_exact_foundation_warehouse_ref.png"
        Output = Join-Path $desktop "World122-研究院-LoRA候选.png"
        Bg = "#00FF00"
        Seed = 819273
    }
)

foreach ($job in $jobs) {
    $source = Get-Content -Raw -Encoding utf8 $job.Prompt
    $tempPrompt = Join-Path $work ("prompts\lora-" + $job.Name + ".txt")
    ("wuxianlunhui world122 building style, " + $source) | Set-Content -LiteralPath $tempPrompt -Encoding utf8
    Write-Log "Generating $($job.Name)."
    & python $generator --host $hostName --model $model --control-image $job.Control `
        --strength 0.88 --steps 48 --cfg 1.0 --seed $job.Seed --size 1024x1024 `
        --transparent --bg-color $job.Bg --prompt-file $tempPrompt --out $job.Output --timeout 900 *>> $log
    if ($LASTEXITCODE -ne 0) {
        Write-Log "Generation failed for $($job.Name), exit $LASTEXITCODE."
        exit $LASTEXITCODE
    }
}

Write-Log "Candidate generation complete."
