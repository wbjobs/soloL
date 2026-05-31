#pragma once
#include "BT/BTDecorator.h"

class BTDecorator_Cooldown : public BTDecorator {
public:
    BTDecorator_Cooldown();
    void SetCooldownDuration(float Duration) { CooldownDuration = Duration; }
    BTStatus Tick(float DeltaTime) override;
    void Initialize() override;
private:
    float CooldownDuration = 5.f;
    float CooldownRemaining = 0.f;
};
