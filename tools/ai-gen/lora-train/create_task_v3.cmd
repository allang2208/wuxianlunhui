@echo off
schtasks /create /tn KleinTrainV3 /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\lora-train-src\train_klein_v3.ps1" /sc once /st 23:59 /ru SYSTEM /f
