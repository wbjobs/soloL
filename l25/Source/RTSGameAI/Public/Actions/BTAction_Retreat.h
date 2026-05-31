#pragma once
#include "BT/BTAction.h"

class BTAction_Retreat : public BTAction {
public:
    BTAction_Retreat();
protected:
    BTStatus Execute(float DeltaTime) override;
private:
    float RetreatThreshold = 0.3f;
};
