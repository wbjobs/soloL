#pragma once
#include "BT/BTAction.h"

class BTAction_Attack : public BTAction {
public:
    BTAction_Attack();
protected:
    BTStatus Execute(float DeltaTime) override;
private:
    float AttackRange = 200.f;
    float AttackCooldown = 1.f;
    float CooldownTimer = 0.f;
};
