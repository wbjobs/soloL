#pragma once
#include "BT/BTDecorator.h"

class BTDecorator_Repeat : public BTDecorator {
public:
    BTDecorator_Repeat();
    void SetRepeatCount(int Count) { MaxRepeats = Count; }
    BTStatus Tick(float DeltaTime) override;
    void Initialize() override;
private:
    int MaxRepeats = -1;
    int CurrentCount = 0;
};
