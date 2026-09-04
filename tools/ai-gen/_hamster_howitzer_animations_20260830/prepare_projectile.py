"""Extract an existing isolated source cartridge and a unit portrait, without repainting."""
from PIL import Image
from make_sprites import ROOT, remove_white_matte, write_json

source = 'reference/projectile-source-die-v04-0032.png'
crop = [326,385,438,435]
shell = remove_white_matte(Image.open(ROOT/source).convert('RGBA')).crop(crop)
shell = shell.rotate(-9,resample=Image.Resampling.BICUBIC,expand=True)
shell = shell.crop(shell.getbbox())
shell.thumbnail((54,25),Image.Resampling.LANCZOS)
canvas = Image.new('RGBA',(64,64))
canvas.alpha_composite(shell,((64-shell.width)//2,(64-shell.height)//2))
canvas.save(ROOT/'final/shell.png')
write_json(ROOT/'projectile-source.json', {'sheet':'final/shell.png','sourceVideo':'videos/die-v04.mp4',
    'sourceFrame':32,'sourceCrop':crop,'rotationDegrees':-9,'contentSize':list(shell.size),
    'sourceCutout':source,'tipDirection':'right','sourceUnchanged':True,
    'meaning':'Inert cartridge dropped by loader; cropped existing art, not an extra death projectile.'})
portrait = remove_white_matte(Image.open(ROOT/'reference/portrait-source-idle-v01-0000.png').convert('RGBA'))
portrait = portrait.crop(portrait.getbbox())
portrait.thumbnail((240,240),Image.Resampling.LANCZOS)
icon = Image.new('RGBA',(256,256))
icon.alpha_composite(portrait,((256-portrait.width)//2,(256-portrait.height)//2))
icon.save(ROOT/'final/unit-icon.png')
print('Prepared shell and unit icon from approved source pixels.')
