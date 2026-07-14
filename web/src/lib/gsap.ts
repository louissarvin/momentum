import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CustomEase } from 'gsap/CustomEase'
import { Flip } from 'gsap/Flip'
import { SplitText } from 'gsap/SplitText'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(
    ScrollTrigger,
    CustomEase,
    Flip,
    SplitText,
    MotionPathPlugin,
  )

  CustomEase.create('momentum-out', 'M0,0 C0.22,1 0.36,1 1,1')
  CustomEase.create('momentum-snap', 'M0,0 C0.19,1 0.22,1 1,1')
  CustomEase.create('momentum-glide', 'M0,0 C0.16,1 0.3,1 1,1')
  CustomEase.create('momentum-tick', 'M0,0 C0.83,0 0.17,1 1,1')
}

export { gsap, ScrollTrigger, CustomEase, Flip, SplitText, MotionPathPlugin }
