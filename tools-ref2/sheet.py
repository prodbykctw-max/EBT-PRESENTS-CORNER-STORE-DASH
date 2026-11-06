import sys
from PIL import Image, ImageDraw, ImageFont
def font(n):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(f,n)
        except Exception: pass
    return ImageFont.load_default()
def sheet(out, panels, width=1600, bar=44):
    n=len(panels); w=width//n
    ims=[]
    for path,label in panels:
        im=Image.open(path).convert('RGB'); h=round(im.height*w/im.width); ims.append((im.resize((w,h),Image.LANCZOS),label))
    H=max(i.height for i,_ in ims)+bar
    S=Image.new('RGB',(w*n,H),(16,19,24)); d=ImageDraw.Draw(S); f=font(22)
    for k,(im,label) in enumerate(ims):
        S.paste(im,(k*w,bar)); d.text((k*w+12,10),label,fill=(255,212,0),font=f)
    S.save(out,quality=88); print(out,S.size)
if __name__=='__main__':
    o='out/'
    M='MAIN (before)'; B='BRANCH (after)'
    sheet(o+'ba_drive_390.jpg',[(o+'main_drive_390.png',M+'  s=600, phone 390x844'),(o+'branch_drive_390.png',B)])
    sheet(o+'ba_bend_390.jpg',[(o+'main_bend_390.png',M+'  s=182 (bend)'),(o+'branch_bend_390.png',B)])
    sheet(o+'ba_onfoot_390.jpg',[(o+'main_foot_390.png',M+'  on foot'),(o+'branch_foot_390.png',B)])
    sheet(o+'ba_park_390.jpg',[(o+'main_near_390.png','MAIN near the spot'),(o+'branch_near_390.png','BRANCH near the spot'),(o+'main_parked_390.png','MAIN parked'),(o+'branch_parked_390.png','BRANCH parked')])
    sheet(o+'cam_heights_390.jpg',[(o+'branch_h2.6.png','h = 2.6'),(o+'branch_drive_390.png','h = 2.8 (default)'),(o+'branch_h3.3.png','h = 3.3')])
    sheet(o+'pullin_chevrons.jpg',[(o+'branch_pullin.png','?pullin  (spot-48)'),(o+'branch_pullin2.png','?pullin  (spot-36)')])
