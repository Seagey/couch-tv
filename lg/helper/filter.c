/* From Clean Your TV (github.com/Razdva122/clean-your-tv-lg-webos), MIT: see LICENSE.cytv.
 * Changed for couch-tv: a triple Home is TOGGLE, and a disabled filter still counts Home taps. */
#include "filter.h"
int filter_event(struct filter*f,const struct ev*e,uint64_t now){
 if(e->type==0&&e->code==3)return RELEASE;
 if(e->type!=1)return PASS;
 if(now<f->last){f->home=0;f->short_press=0;f->count=0;f->back=0;}
 f->last=now;
 /* Cursor-show notifications are not physical button presses. */
 if(e->code==1198)return PASS;
 if(e->code==412){
  if(e->value==1&&!f->back){f->back=1;f->back_fired=0;f->back_since=now;}
  if(e->value==0){f->back=0;f->back_fired=0;}
 }
 if(e->code!=773){if(e->value){f->short_press=0;f->count=0;}return PASS;}
 int act=DROP;
 if(e->value==1){
  int held=f->home;
  if(held)f->count=0;
  f->home=1;f->short_press=1;f->since=now;
  act=held?DROP:OPEN_HOME;
 }
 if(e->value==2){f->short_press=0;f->count=0;}
 if(e->value==0){
  int valid=f->home&&f->short_press&&now-f->since>=40&&now-f->since<=500;
  f->home=0;f->short_press=0;
  if(!valid)f->count=0;
  else{
   int kept=0;
   for(int i=0;i<f->count;i++)if(now-f->taps[i]<=2000)f->taps[kept++]=f->taps[i];
   f->taps[kept++]=f->since;f->count=kept;
   if(kept==3){f->count=0;return TOGGLE;}
  }
 }
 /* Disabled: webOS gets Home as usual; the taps above are still counted, to switch back on. */
 return f->disabled?PASS:act;
}
/* A long Back opens stock Home once; it never releases the helper. */
int filter_timeout(struct filter*f,uint64_t now){
 if(f->back&&!f->back_fired&&now>=f->back_since&&now-f->back_since>=1200){f->back_fired=1;return OPEN_LG;}
 return 0;
}
