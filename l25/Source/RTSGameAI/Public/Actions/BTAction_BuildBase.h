#pragma once
#include "BT/BTAction.h"

class BTAction_BuildBase : public BTAction {
public:
    BTAction_BuildBase();
protected:
    BTStatus Execute(float DeltaTime) override;
private:
    float BuildTimer = 0.f;
    float BuildInterval = 5.f;
    int MaxBarracksCount = 3;
};
