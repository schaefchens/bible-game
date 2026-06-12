import type { Scene } from '@bible/engine'

// Tutorial point-and-click scenes. The old well teaches the verb coin: OBSERVE (something glitters
// in the dark), PULL (haul the bucket up), then TAKE (a purse of 100 gold — enough to buy at the
// market just ahead). Flags gate the order; `wellLooted` makes the take a one-time reward.
export const TUTORIAL_SCENES: Record<string, Scene> = {
  tutorialWell: {
    id: 'tutorialWell',
    bgAsset: 'bg-waypoint-lower-well',
    hotspots: [
      {
        id: 'well',
        shape: { x: 0.36, y: 0.4, w: 0.28, h: 0.38 },
        nameKey: 'scene.tutorialWell.well',
        defaultVerb: 'observe',
        interactions: {
          observe: { fallbackLineKey: 'scene.tutorialWell.well.observe' },
          pull: {
            script: [
              {
                if: { flag: 'wellBucketUp', eq: true },
                then: [{ say: 'scene.tutorialWell.well.pullAgain', speaker: 'hero' }],
                else: [{ setFlag: 'wellBucketUp', value: true }, { say: 'scene.tutorialWell.well.pull', speaker: 'hero' }],
              },
            ],
          },
          take: {
            script: [
              {
                if: { flag: 'wellBucketUp', eq: true },
                then: [
                  {
                    if: { flag: 'wellLooted', eq: true },
                    then: [{ say: 'scene.tutorialWell.well.empty', speaker: 'hero' }],
                    else: [
                      { giveGold: 100 },
                      { setFlag: 'wellLooted', value: true },
                      { say: 'scene.tutorialWell.well.take', speaker: 'hero' },
                    ],
                  },
                ],
                else: [{ say: 'scene.tutorialWell.well.takeNoBucket', speaker: 'hero' }],
              },
            ],
          },
        },
      },
    ],
  },
}
