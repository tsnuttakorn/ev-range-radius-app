package com.anonymous.evrangeradiusapp

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.ItemList
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

class EVMapScreen(carContext: CarContext) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        // Construct the list layout for the Android Auto screen.
        // This is a simple template displaying mock active vehicle status and option to search.
        val listBuilder = ItemList.Builder()
            .addItem(
                Row.Builder()
                    .setTitle("BYD Atto 3 (Active)")
                    .addText("Range Remaining: 240 km (80%)")
                    .build()
            )
            .addItem(
                Row.Builder()
                    .setTitle("Find Chargers Nearby")
                    .addText("Search using voice command or keyboard")
                    .setOnClickListener {
                        screenManager.push(EVSearchScreen(carContext))
                    }
                    .build()
            )

        return PlaceListMapTemplate.Builder()
            .setTitle("EV Range Radius")
            .setItemList(listBuilder.build())
            .setActionStrip(
                ActionStrip.Builder()
                    .addAction(Action.BACK)
                    .build()
            )
            .build()
    }
}
