#pragma once
#include "BT/BTDecorator.h"

class BTDecorator_Inverter : public BTDecorator {
public:
    BTDecorator_Inverter();
    BTStatus Tick(float DeltaTime) override;
};
