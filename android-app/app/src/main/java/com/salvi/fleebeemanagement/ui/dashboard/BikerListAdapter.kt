package com.salvi.fleebeemanagement.ui.dashboard

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import com.salvi.fleebeemanagement.R
import com.salvi.fleebeemanagement.databinding.ItemBikerBinding
import com.salvi.fleebeemanagement.model.Biker

class BikerListAdapter(
    context: Context,
    private val items: List<Biker>
) : ArrayAdapter<Biker>(context, 0, items) {

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val binding = if (convertView == null) {
            ItemBikerBinding.inflate(LayoutInflater.from(context), parent, false).also {
                it.root.tag = it
            }
        } else {
            convertView.tag as ItemBikerBinding
        }

        val biker = items[position]
        binding.nameText.text = biker.name
        binding.routeText.text = context.getString(
            R.string.list_item_route_format,
            biker.phoneNumber,
            biker.bikePlate
        )
        binding.bikeText.text = biker.bikeModel

        val priority = when {
            biker.urgentAlert -> context.getString(R.string.dashboard_status_emergency)
            biker.reminderDue -> context.getString(R.string.dashboard_status_due)
            else -> context.getString(R.string.dashboard_status_clear)
        }
        binding.statusText.text = context.getString(
            R.string.list_item_status_format,
            biker.status,
            priority
        )

        return binding.root
    }
}
