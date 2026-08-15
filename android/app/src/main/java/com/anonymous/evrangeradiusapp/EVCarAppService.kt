package com.anonymous.evrangeradiusapp

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class EVCarAppService : CarAppService() {
    override fun createHostValidator(): HostValidator {
        // ALLOW_ALL_HOSTS_VALIDATOR allows running the app on simulators/DHUs during testing
        return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    }

    override fun onCreateSession(): Session {
        return object : Session() {
            override fun onCreateScreen(intent: Intent): Screen {
                return EVMapScreen(carContext)
            }
        }
    }
}
