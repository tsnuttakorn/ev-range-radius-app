package com.anonymous.evrangeradiusapp

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template

class EVSearchScreen(carContext: CarContext) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        return SearchTemplate.Builder(object : SearchTemplate.SearchCallback {
            override fun onSearchSubmitted(searchText: String) {
                // When search is submitted (via voice input or keyboard)
                // In a production app, we would search stations or locations using OCM/Overpass API
                // And then navigate back or show results on the map
            }

            override fun onSearchTextChanged(searchText: String) {
                // Handle live search suggestions if needed
            }
        })
        .setHeaderAction(Action.BACK)
        .setShowKeyboardByDefault(false) // Keeps the keyboard minimized so the driver sees the voice search prompt
        .setSearchHint("Speak or type charging station...")
        .build()
    }
}
