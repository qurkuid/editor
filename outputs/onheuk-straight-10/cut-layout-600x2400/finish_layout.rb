require 'json'
module OnheukCutFinish
  ROOT='/Users/changseok/editor/outputs/onheuk-straight-10/cut-layout-600x2400'
  def self.area(ring)
    ring.each_with_index.sum{|p,i|q=ring[(i+1)%ring.length];p[0]*q[1]-q[0]*p[1]}.abs/2.0
  end
  def self.top(view,bounds)
    center=bounds.center
    view.camera=Sketchup::Camera.new(center+[0,0,10000.mm],center,[0,1,0],false)
    aspect=view.vpwidth.to_f/[view.vpheight,1].max
    view.camera.height=[bounds.height*1.2,bounds.width/aspect*1.15,400.mm].max
    view.refresh
  end
  def self.run
    m=Sketchup.active_model
    raise 'Wrong layout file' unless File.basename(m.path)=='onheuk-10-cut-layout-600x2400.skp'
    data=JSON.parse(File.read(File.join(ROOT,'nesting.json')))
    products=JSON.parse(File.read(File.join(ROOT,'..','catalog.json')))['products']
    groups=m.entities.grep(Sketchup::Group).sort_by(&:name)
    sheets=data['sheets'].sort_by{|s|s['id']}
    raise 'Sheet count mismatch' unless groups.length==sheets.length
    seen=[]
    report=groups.zip(sheets).map do |g,s|
      raise 'Sheet id mismatch' unless g.name==s['id']
      parts=g.entities.grep(Sketchup::Group).select{|p|p.name.start_with?('P')}
      raise 'Part count mismatch' unless parts.length==s['parts'].length
      results=s['parts'].map do |p|
        part=parts.find{|a|a.name==p['id']};raise "Missing #{p['id']}" unless part
        original=products[p['product_index']-1]['parts'][p['part_index']-1]
        volume=(area(original['outer_mm'])-original.fetch('holes_mm',[]).sum{|r|area(r)})*original['thickness_mm']
        bb=part.bounds
        actual=[bb.min.x.to_mm,bb.min.y.to_mm,bb.width.to_mm,bb.height.to_mm,bb.depth.to_mm]
        expected=[p['y_mm'],600-p['x_mm']-p['w_mm'],p['h_mm'],p['w_mm'],s['thickness_mm']]
        raise "Position or dimensions #{p['id']}" unless actual.zip(expected).all?{|a,b|(a-b).abs<0.01}
        raise "Non solid #{p['id']}" unless part.manifold?
        raise "Volume #{p['id']}" unless (part.volume*25.4**3-volume).abs<[0.01,volume*1e-7].max
        raise "Curve #{p['id']}" if part.entities.grep(Sketchup::Edge).any?(&:curve)
        raise "Outside sheet #{p['id']}" unless p['x_mm']>=10 && p['y_mm']>=10 && p['x_mm']+p['w_mm']<=590.001 && p['y_mm']+p['h_mm']<=2390.001
        seen<<p['id']
        part.set_attribute('CutPlan','Product',products[p['product_index']-1]['name'])
        part.set_attribute('CutPlan','Part',original['name'])
        part.set_attribute('CutPlan','Status','사진 추정 치수 — 재단 보류')
        p.each{|k,v|part.set_attribute('CutPlan',k,v)}
        {id:p['id'],solid:true,volume_mm3:volume,position_verified:true,thickness_mm:s['thickness_mm']}
      end
      s['parts'].combination(2) do |a,b|
        gap=[b['x_mm']-a['x_mm']-a['w_mm'],a['x_mm']-b['x_mm']-b['w_mm'],b['y_mm']-a['y_mm']-a['h_mm'],a['y_mm']-b['y_mm']-b['h_mm']].max
        raise "Kerf gap #{a['id']}/#{b['id']}" if gap<3.999
      end
      {sheet:s['id'],thickness_mm:s['thickness_mm'],part_count:results.length,parts:results}
    end
    raise '89 unique parts required' unless seen.length==89 && seen.uniq.length==89
    m.start_operation('온장 배치 검증과 재단 표시',true)
    begin
      m.options['UnitsOptions']['LengthUnit']=2
      m.options['UnitsOptions']['LengthFormat']=0
      m.options['UnitsOptions']['LengthPrecision']=1
      %w[DisplaySketchAxes DrawGround DrawHorizon DrawSilhouettes DrawLineEnds].each{|key|m.rendering_options[key]=false}
      m.rendering_options['BackgroundColor']=Sketchup::Color.new(250,250,247)
      m.shadow_info['DisplayShadows']=false
      ink=m.materials.add('부품 번호 먹색');ink.color=Sketchup::Color.new(35,45,50)
      groups.zip(sheets).each do |g,s|
        g.entities.grep(Sketchup::Group).select{|a|a.name.start_with?('부품 번호')}.each(&:erase!)
        g.entities.grep(Sketchup::Text).each(&:erase!)
        g.entities.grep(Sketchup::DimensionLinear).each(&:erase!)
        notes=g.entities.add_group;notes.name='부품 번호 및 직사각형 재단선 — 목재 아님'
        s['parts'].each do |p|
          left=p['y_mm'];bottom=600-p['x_mm']-p['w_mm'];t=s['thickness_mm']
          points=[[left,bottom],[left+p['h_mm'],bottom],[left+p['h_mm'],bottom+p['w_mm']],[left,bottom+p['w_mm']]].map{|x,y|[x.mm,y.mm,(t+0.2).mm]}
          notes.entities.add_edges(*(points+[points.first]))
          label=notes.entities.add_group;label.name="표시 #{p['id']}"
          text=p['id']
          text += "\n#{p['w_mm']} × #{p['h_mm']}" if [p['w_mm'],p['h_mm']].min>=100
          raise '3D text creation' unless label.entities.add_3d_text(text,TextAlignCenter,'Arial',false,false,18.mm,0.0,0.0,true,0.0)
          label.entities.grep(Sketchup::Face).each{|f|f.material=ink;f.back_material=ink}
          if p['h_mm']<p['w_mm']
            label.transform!(Geom::Transformation.rotation(ORIGIN,Z_AXIS,90.degrees))
          end
          bb=label.bounds
          factor=[1.0,(p['h_mm']-4).mm/bb.width,(p['w_mm']-4).mm/bb.height].min
          label.transform!(Geom::Transformation.scaling(factor))
          delta=Geom::Point3d.new((left+p['h_mm']/2.0).mm,(bottom+p['w_mm']/2.0).mm,(t+0.4).mm)-label.bounds.center
          label.transform!(Geom::Transformation.translation(delta))
        end
        g.entities.add_text("#{s['id']} · #{s['thickness_mm']}T · #{s['parts'].length}부품\n600 × 2400 mm / 톱날 4 / 여유 10 / 사진 추정 치수 — 재단 보류",[0,-180.mm,0])
        g.entities.add_dimension_linear([0,0,0],[2400.mm,0,0],[0,-60.mm,0])
        g.entities.add_dimension_linear([0,0,0],[0,600.mm,0],[-60.mm,0,0])
        g.entities.add_text('도면 왼쪽 위 (X0,Y0) / X: 짧은 변 아래 / Y: 긴 변 오른쪽',[0,650.mm,0])
        g.set_attribute('CutPlan','Thickness',s['thickness_mm'])
        g.set_attribute('CutPlan','StockSize',[600,2400])
        g.set_attribute('CutPlan','Kerf',4)
        g.set_attribute('CutPlan','Margin',10)
        g.set_attribute('CutPlan','FabricationStatus','치수·결합부 확정 전 재단 보류')
      end
      m.pages.to_a.each{|p|m.pages.erase(p)}
      groups.each{|g|g.hidden=false}
      top(m.active_view,m.bounds)
      overview=m.pages.add('00 온장 전체 배치',PAGE_USE_ALL);overview.transition_time=0
      groups.each_with_index do |g,i|
        groups.each{|other|other.hidden=other!=g}
        top(m.active_view,g.bounds)
        page=m.pages.add(g.name,PAGE_USE_ALL);page.transition_time=0
        m.active_view.camera.height=[g.bounds.height*1.2,g.bounds.width/(1600.0/650)*1.1].max
        m.active_view.refresh
        m.active_view.write_image(filename:File.join(ROOT,"sheet-#{g.name}.png"),width:1600,height:650,antialias:true,transparent:false)
      end
      groups.each{|g|g.hidden=false};top(m.active_view,m.bounds)
      m.pages.selected_page=overview;m.active_view.refresh
      m.commit_operation
    rescue Exception
      m.abort_operation;raise
    end
    raise 'Save failed' unless m.save
    m.active_view.write_image(filename:File.join(ROOT,'layout-preview.png'),width:1800,height:1200,antialias:true,transparent:false)
    evidence={file:m.path,sheet_count:groups.length,part_count:seen.length,all_solid:true,all_positions_verified:true,no_overlap:true,kerf_mm:4,margin_mm:10,source_geometry_preserved:true,fabrication_status:'치수 및 결합부 미확정 — 재단 보류',scenes:m.pages.map(&:name),sheets:report}
    File.write(File.join(ROOT,'native-verification.json'),JSON.pretty_generate(evidence))
    puts "CUT LAYOUT COMPLETE: #{groups.length} sheets / #{seen.length} solids; dimensions, volumes and kerf verified"
  end
end
OnheukCutFinish.run
