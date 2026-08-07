@echo off
schtasks /create /tn KleinWalltexTrain /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\lora-train-src\train_klein_walltex.ps1" /sc once /st 23:59 /ru SYSTEM /f
