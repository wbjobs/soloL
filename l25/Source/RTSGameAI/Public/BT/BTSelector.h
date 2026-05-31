#pragma once
#include "BT/BTComposite.h"

class BTSelector : public BTComposite {
public:
    BTStatus Tick(float DeltaTime) override;
    void Initialize() override;
};
