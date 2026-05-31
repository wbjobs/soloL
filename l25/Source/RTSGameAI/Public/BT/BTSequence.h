#pragma once
#include "BT/BTComposite.h"

class BTSequence : public BTComposite {
public:
    BTStatus Tick(float DeltaTime) override;
    void Initialize() override;
};
